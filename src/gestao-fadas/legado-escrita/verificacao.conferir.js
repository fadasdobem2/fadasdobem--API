'use strict';

/**
 * Uma conferência da trava da ficha do ASP (Maturacao/53). Uma transação do Postgres por conferência, com a linha travada (`FOR UPDATE SKIP LOCKED`):
 * duas instâncias da API nunca conferem a mesma. Relê o campo no legado e decide (`verificacao.decidir`):
 *   igual ao que gravamos -> `ok`; voltou ao valor antigo -> REAPLICA uma vez (só cliente; `legado_estado = reaplicada`), de novo -> `divergente`;
 *   outro valor -> `divergente` e NÃO sobrescreve (o legado é a fonte: a leitura já mostra o dele, `fusao.js`). Nunca INSERT/DELETE no legado: o único
 *   UPDATE é o da allowlist de `sql.entidades.js`, sob a trava de banco. O log operacional (Configurações > Logs) recebe `divergente`/`reaplicada` sem valores.
 */

const { randomUUID } = require('crypto');
const { emTransacao: emPostgres } = require('../novo/escritor');
const { MapeamentoError } = require('./mapeamento');
const v = require('./verificacao');

const legado = () => require('./index');
const LEITORES = { clientes: () => require('./clientes').ler, tarologos: () => require('./tarologos').ler };
const ATUALIZADORES = { clientes: () => require('./clientes').atualizar };
const MAX_TENTATIVAS = 5;
const json = (x) => (typeof x === 'string' ? JSON.parse(x) : x || null);

const FRASES = {
  voltou_ao_valor_antigo: 'o sistema antigo regravou o valor anterior (ficha antiga aberta); o painel reaplicou o valor novo, uma única vez.',
  voltou_ao_valor_antigo_de_novo: 'o valor anterior voltou de novo depois da reaplicação; nada mais é reaplicado. Confira o cadastro.',
  voltou_ao_valor_antigo_sem_reaplicar: 'voltou ao valor anterior no sistema antigo; este cadastro não é reaplicado automaticamente. Confira.',
  valor_diferente: 'foi alterado no sistema antigo para outro valor; o valor do sistema antigo foi mantido (não foi sobrescrito).',
  sem_registro: 'o registro não foi encontrado no sistema antigo.',
  reaplicacao_recusada: 'o sistema antigo não aceitou a reaplicação; o valor do sistema antigo foi mantido.',
  erro_de_leitura: 'não foi possível conferir no sistema antigo depois de várias tentativas.',
};

async function ler(entidade, legadoId) {
  return legado().emTransacao((lx) => LEITORES[entidade]()(lx, legadoId), { entidade });
}

async function encerrarCadeia(pg, x, estado, detalhe) {
  await pg.execute("UPDATE gf_legado_verificacoes SET estado = ?, detalhe = ?, atualizado_em = CURRENT_TIMESTAMP WHERE intencao_id = ? AND coluna = ? AND estado = 'pendente' AND id <> ?", [estado, detalhe, x.intencao_id, x.coluna, x.id]);
}

/** Estado do cadastro (`legado_estado`) e, na divergência, o campo deixa de contar como pendente (o legado manda na leitura). */
async function marcarCadastro(pg, p, x, estado, detalhe, tirarPendente) {
  const [l] = await pg.execute(`SELECT legado_pendentes FROM ${p.tabela} WHERE ${p.chave} = ? FOR UPDATE`, [x.entidade_id]);
  if (!l[0]) return;
  const pend = (json(l[0].legado_pendentes) || []).filter((c) => !(tirarPendente && c === p.campoFront[x.coluna]));
  await pg.execute(`UPDATE ${p.tabela} SET legado_estado = ?, legado_detalhe = ?, legado_pendentes = ?, legado_atualizado_em = CURRENT_TIMESTAMP WHERE ${p.chave} = ?`, [estado, detalhe.slice(0, 300), JSON.stringify(pend), x.entidade_id]);
}

/** Evento no formato do log operacional do front (Configurações > Logs). Sem valores: só o campo e o tipo. */
async function registrarLog(pg, p, x, intencao, resultado, tipo, agora) {
  // Quem editou: a função (perfil) gravada na auditoria do próprio pedido (mesma entidade, logo depois da intenção). Nome de pessoa não entra.
  const [a] = await pg.execute("SELECT ator_funcao FROM gf_auditoria WHERE entidade_id = ? AND acao LIKE 'cadastros.%' AND ocorrido_em >= ? ORDER BY ocorrido_em LIMIT 1", [String(x.entidade_id), new Date(intencao.criado_em).getTime() - 10_000]);
  const quem = a[0] ? ` Edição feita por: ${a[0].ator_funcao}.` : '';
  const at = new Date(agora).toISOString();
  const evento = {
    id: `legado-verif:${x.id}:${resultado}`, category: p.categoria, action: resultado === 'reaplicada' ? 'Valor reaplicado após o sistema antigo regravar' : 'Divergência com o sistema antigo',
    recordId: String(x.entidade_id), ...(x.entidade === 'clientes' ? { clientId: String(x.entidade_id) } : { tarotId: String(x.entidade_id) }),
    detail: `Campo "${v.ROTULO[x.coluna]}": ${FRASES[tipo] || tipo}${quem}`, origin: 'captured', actorName: 'Sistema (conferência do sistema antigo)', actorKind: 'system', at,
  };
  await pg.execute('INSERT IGNORE INTO gf_log_operacional (id, categoria, ocorrido_em, item, registrado_por, conta_id, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [evento.id, p.categoria, at, JSON.stringify(evento), 'Sistema', 'sistema', `verif:${x.id}`.slice(0, 128)]);
}

/** Resultado da conferência de `id`: `null` (nada a fazer / outra instância tem a linha / flag desligada) ou `{ estado, tipo }`. */
async function conferir(id, { agora = Date.now(), env = process.env } = {}) {
  return emPostgres(async (pg) => {
    const [[x]] = await pg.execute("SELECT * FROM gf_legado_verificacoes WHERE id = ? AND estado = 'pendente' AND vence_em <= ? FOR UPDATE SKIP LOCKED", [id, new Date(agora).toISOString()]);
    if (!x || !v.ativa(x.entidade, env)) return null;
    const p = v.POLITICA[x.entidade];
    const [[it]] = await pg.execute('SELECT id, operation_key, antes, depois, criado_em FROM gf_legado_intencoes WHERE id = ?', [x.intencao_id]);
    const antigo = it && json(it.antes) ? json(it.antes)[x.coluna] : undefined; const novo = it && json(it.depois) ? json(it.depois)[x.coluna] : undefined;
    const fecha = async (estado, detalhe) => { await pg.execute('UPDATE gf_legado_verificacoes SET estado = ?, detalhe = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [estado, detalhe, x.id]); };
    if (!it || novo === undefined) { await fecha('encerrada', 'intenção ausente'); return { estado: 'encerrada', tipo: 'sem_intencao' }; }
    // Uma edição mais nova do mesmo campo (inclusive em andamento) torna esta conferência sem sentido.
    const [mais] = await pg.execute("SELECT 1 AS x FROM gf_legado_intencoes WHERE entidade = ? AND entidade_id = ? AND criado_em > ? AND id <> ? AND estado IN ('iniciada', 'concluida') AND (depois ->> ?) IS DISTINCT FROM (antes ->> ?) AND (depois ->> ?) IS NOT NULL LIMIT 1", [x.entidade, x.entidade_id, it.criado_em, it.id, x.coluna, x.coluna, x.coluna]);
    if (mais.length) { await fecha('encerrada', 'substituída por uma edição mais nova do mesmo campo'); await encerrarCadeia(pg, x, 'encerrada', 'substituída por uma edição mais nova do mesmo campo'); return { estado: 'encerrada', tipo: 'substituida' }; }

    const adiar = async (motivo) => {
      const tentativas = Number(x.tentativas) + 1;
      if (tentativas >= MAX_TENTATIVAS) return divergir('erro_de_leitura');
      await pg.execute('UPDATE gf_legado_verificacoes SET tentativas = ?, vence_em = ?, detalhe = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [tentativas, new Date(agora + 120_000).toISOString(), `adiada: ${motivo}`.slice(0, 300), x.id]);
      return { estado: 'adiada', tipo: motivo };
    };
    const divergir = async (tipo) => {
      await fecha('divergente', tipo); await encerrarCadeia(pg, x, 'encerrada', `cadeia encerrada: ${tipo}`);
      await marcarCadastro(pg, p, x, 'divergente', `${v.ROTULO[x.coluna]}: ${tipo}`, true); await registrarLog(pg, p, x, it, 'divergente', tipo, agora);
      return { estado: 'divergente', tipo };
    };

    let linha;
    try { linha = await ler(x.entidade, x.legado_id); } catch (e) { return adiar('leitura_falhou'); }
    const d = v.decidir({ atual: linha ? linha[x.coluna] : null, antigo, novo, reaplicada: x.apos_reaplicacao, reaplica: p.reaplica, existe: Boolean(linha) });
    if (d.acao === 'ok') {
      await fecha('ok', d.tipo);
      if (!x.apos_reaplicacao) await encerrarCadeia(pg, x, 'encerrada', 'campo conferido: igual ao gravado');
      return { estado: 'ok', tipo: d.tipo };
    }
    if (d.acao === 'divergente') return divergir(d.tipo);

    // Reaplicar UMA vez, pela allowlist de UPDATE do cliente (mesma trava de banco).
    let n;
    try { n = await legado().emTransacao((lx) => ATUALIZADORES[x.entidade]()(lx, x.legado_id, { [x.coluna]: novo }), { entidade: x.entidade }); } catch (e) {
      if (e instanceof MapeamentoError || (e && e.codigo === 'BANCO_NAO_AUTORIZADO')) return divergir('reaplicacao_recusada');
      return adiar('reaplicacao_falhou');
    }
    if (!n) return divergir('sem_registro');
    await fecha('reaplicada', d.tipo);
    await pg.execute("UPDATE gf_legado_verificacoes SET apos_reaplicacao = TRUE, atualizado_em = CURRENT_TIMESTAMP WHERE intencao_id = ? AND coluna = ? AND estado = 'pendente'", [x.intencao_id, x.coluna]);
    // Mais uma conferência logo depois: pega a ficha regravando DE NOVO mesmo se a reaplicação foi na última etapa.
    await pg.execute('INSERT INTO gf_legado_verificacoes (id, intencao_id, entidade, entidade_id, legado_id, coluna, etapa, vence_em, apos_reaplicacao, detalhe) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)',
      [randomUUID(), x.intencao_id, x.entidade, x.entidade_id, x.legado_id, x.coluna, Number(x.etapa) + 100, new Date(agora + v.etapas(env)[0] * 60_000).toISOString(), 'conferência depois da reaplicação']);
    await marcarCadastro(pg, p, x, 'reaplicada', `${v.ROTULO[x.coluna]}: reaplicado uma vez`, false); await registrarLog(pg, p, x, it, 'reaplicada', d.tipo, agora);
    return { estado: 'reaplicada', tipo: d.tipo };
  });
}

module.exports = { conferir, FRASES };
