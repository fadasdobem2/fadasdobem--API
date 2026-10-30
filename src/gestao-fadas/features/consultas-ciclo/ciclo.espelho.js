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

const { detalheComChave } = legado.chave;

/** Registra a sincronização para depois do commit e a INTENÇÃO dentro da transação. Sem o interruptor, não faz nada (nem toca o legado). */
async function agendar(ex, { id, momento, item }) {
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

async function espelharNoLegado(pg, lx, reg, linha, momento) {
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
