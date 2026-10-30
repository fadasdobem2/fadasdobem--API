'use strict';

/**
 * Espelho da consulta em `tbl_consultas` (dados, nunca estrutura). DESLIGADO por padrão: só roda com `GF_LEGADO_ESCRITA_ENABLED=true`
 * (e nunca no ambiente local do Patrick). A verdade é o Postgres; o legado recebe uma cópia para o sistema antigo continuar lendo:
 *   - INSERT ao lançar (linha aberta, `fimConsulta` zerado), UPDATE ao iniciar, encerrar ou corrigir (sempre o estado atual inteiro,
 *     então repetir é inofensivo);
 *   - o vínculo (`gf_consultas_ext.id_consulta_legado`) e o estado (`nao_espelhada`, `pendente`, `espelhada`, `sem_tarologo`, `erro`)
 *     ficam no Postgres, porque não se pode acrescentar coluna no legado; `erro`/`pendente` são refeitos na próxima gravação;
 *   - roda DEPOIS do commit do Postgres (nunca dentro da transação): se o legado falha, a consulta já está gravada e o erro fica no estado.
 * ÓRFÃS: a INTENÇÃO (`pendente` + chave natural, `ciclo.intencao.js`) é gravada na transação da consulta, antes do INSERT no legado.
 * Antes de INSERIR, o espelho PROCURA no legado (leitura) uma linha que já corresponda à chave: se achar uma, ADOTA (vincula e atualiza)
 * em vez de duplicar; se achar mais de uma, não decide sozinho (`erro` "ambígua"). `ciclo.reconciliacao.js` refaz as `pendente` antigas.
 */

const { emTransacao: emPostgres } = require('../../novo/escritor');
const legado = require('../../legado-escrita');
const store = require('./ciclo.store');
const intencao = require('./ciclo.intencao');
const lp = require('../../legado-escrita/legado-primeiro');
const intencoes = require('../../legado-escrita/intencoes');

const { detalheComChave } = legado.chave;

/**
 * LEGADO PRIMEIRO (Maturacao/46): dentro do pedido (transação do Postgres aberta), escreve a consulta em `tbl_consultas` ANTES do commit. Falha do legado
 * (ou órfã ambígua) -> 503 e o Postgres desfaz tudo: a consulta não é salva. Tarólogo sem código no legado (`sem_tarologo`) não tem casa lá: a consulta
 * é salva só no Postgres, com o estado `sem_tarologo` (não é falha do legado). Repetir (mesma chave natural) ADOTA a linha já inserida em vez de duplicar.
 * O objeto completo do front (pausas, comissão, eventos, segundos) é novo e fica em `gf_consultas_ext`; só as colunas de `tbl_consultas` vão ao legado.
 */
async function escreverPrimeiro(ex, { id, momento, item }) {
  const reg = await store.travar(ex, id);
  if (!reg) return;
  const linha = await intencao.estadoDoEspelho(ex, id);
  let intencaoId = null;
  let dados;
  try {
    dados = await legado.emTransacao(async (lx) => {
      intencaoId = await intencoes.abrir({ entidade: 'consultas', entidadeId: id, escopo: momento, legadoId: reg.legadoId, depois: { momento, chave: intencao.escolherChave(linha, item) } });
      const r = await espelharNoLegado(ex, lx, { item, legadoId: reg.legadoId }, linha, momento);
      if (r.estado === 'erro') throw new Error(r.detalhe);
      return r;
    }, { entidade: 'consultas' });
  } catch (e) {
    if (intencaoId) await intencoes.marcar(intencaoId, 'revertida', `o legado não gravou: ${(e && (e.codigo || e.message)) || 'erro'}`);
    throw lp.falhaDoLegado(e);
  }
  await store.marcarLegado(ex, id, dados);
  await intencoes.concluirNaTransacao(ex, intencaoId, dados.legadoId);
  if (Array.isArray(ex.compensacoes)) {
    // O INSERT no legado não se desfaz (nunca DELETE): se o Postgres falhar depois, a linha fica órfã e a próxima tentativa a ADOTA pela chave natural.
    ex.compensacoes.push(() => intencoes.marcar(intencaoId, 'divergente', `o Postgres falhou depois de o legado receber a consulta${dados.legadoId ? ` (idConsulta ${dados.legadoId})` : ''}: o legado fica à frente até a próxima gravação`, dados.legadoId));
  }
}

/** Registra a sincronização para depois do commit e a INTENÇÃO dentro da transação. Sem o interruptor, não faz nada (nem toca o legado). */
async function agendar(ex, { id, momento, item }) {
  if (lp.modoPrimeiro()) { if (lp.ativo('consultas')) await escreverPrimeiro(ex, { id, momento, item }); return; }
  if (!legado.espelhoLigado() || !Array.isArray(ex.posCommit)) return;
  if (item) await intencao.registrar(ex, id, item);
  ex.posCommit.push(() => sincronizar(id, momento));
}

/** Escolhe a linha do legado desta consulta: uma já vinculada no Postgres, nenhuma (insere) ou a órfã (adota). */
async function acharOrfa(pg, lx, chave, tid) {
  if (!chave) return { nenhuma: true };
  const achadas = await legado.consultas.buscarCandidatas(lx, { ...chave, idTarologo: tid });
  const livres = [];
  for (const idLegado of achadas) {
    const [dono] = await pg.execute('SELECT id FROM gf_consultas_ext WHERE id_consulta_legado = ?', [idLegado]);
    if (!dono.length) livres.push(idLegado);
  }
  if (livres.length === 1) return { adotar: livres[0] };
  return livres.length ? { ambigua: livres } : { nenhuma: true };
}

/** T10 (Maturacao/47 Q11): status 1/2 do tarólogo, só com a flag própria e DEPOIS de a consulta estar no legado. */
async function marcarStatus(lx, tid, idLegado, item) {
  if (`${process.env.GF_LEGADO_STATUS_TAROLOGO || ''}`.trim().toLowerCase() !== 'true') return; // flag própria, além do interruptor geral (já conferido por quem chama)
  await legado.tarologoStatus.marcar(lx, tid, idLegado, !legado.mapeamento.linhaDoLegado(item, tid, new Date()).fechada);
}

async function espelharNoLegado(pg, lx, reg, linha, momento) {
  const r = await espelharConsulta(pg, lx, reg, linha, momento);
  if (r.estado === 'espelhada') await marcarStatus(lx, await legado.consultas.resolverTarologo(lx, reg.item.tarotId), r.legadoId || reg.legadoId, reg.item);
  return r;
}

async function espelharConsulta(pg, lx, reg, linha, momento) {
  const tid = await legado.consultas.resolverTarologo(lx, reg.item.tarotId);
  const chave = intencao.escolherChave(linha, reg.item);
  const agora = new Date();
  if (tid === null) return { estado: 'sem_tarologo', detalhe: detalheComChave('tarólogo sem código no legado (nmcTarologo)', chave) };
  if (reg.legadoId) {
    const n = await legado.consultas.atualizar(lx, reg.legadoId, reg.item, tid, agora);
    return n ? { estado: 'espelhada', detalhe: `atualizada (${momento})` } : { estado: 'erro', detalhe: 'linha do legado não encontrada para esta cliente' };
  }
  const orfa = await acharOrfa(pg, lx, chave, tid);
  if (orfa.ambigua) return { estado: 'erro', detalhe: detalheComChave(`órfã ambígua: ${orfa.ambigua.length} linhas no legado com a mesma chave (decisão humana)`, chave) };
  if (orfa.adotar) {
    const n = await legado.consultas.atualizar(lx, orfa.adotar, reg.item, tid, agora);
    return n ? { legadoId: orfa.adotar, estado: 'espelhada', detalhe: `órfã adotada (${momento})` } : { estado: 'erro', detalhe: detalheComChave('órfã achada não aceitou a atualização', chave) };
  }
  const novo = await legado.consultas.inserir(lx, reg.item, tid, agora);
  return { legadoId: novo, estado: 'espelhada', detalhe: `inserida (${momento})` };
}

async function sincronizar(id, momento) {
  let chaveSalva = null;
  try {
    return await emPostgres(async (pg) => {
      const reg = await store.travar(pg, id);
      if (!reg) return null;
      const linha = await intencao.estadoDoEspelho(pg, id);
      chaveSalva = intencao.escolherChave(linha, reg.item);
      const dados = await legado.emTransacao((lx) => espelharNoLegado(pg, lx, reg, linha, momento));
      await store.marcarLegado(pg, id, dados);
      return dados;
    });
  } catch (erro) {
    // Falha do legado (rede, modo, validação de data...): a consulta continua gravada; o motivo vai para o estado, sem segredo.
    // A chave da intenção segue no detalhe: se o INSERT chegou a acontecer, a próxima tentativa adota a linha em vez de duplicar.
    const motivo = `${(erro && (erro.codigo || erro.code)) || 'erro'}: ${String((erro && erro.message) || '').slice(0, 150)}`;
    const detalhe = detalheComChave(motivo, chaveSalva);
    await emPostgres(async (pg) => store.marcarLegado(pg, id, { estado: 'erro', detalhe })).catch(() => {});
    console.error('[gf-consulta.espelho] falhou:', motivo);
    return { estado: 'erro', detalhe };
  }
}

module.exports = { agendar, sincronizar };
