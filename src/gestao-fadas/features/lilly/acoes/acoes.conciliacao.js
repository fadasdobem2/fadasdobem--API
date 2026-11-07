'use strict';

/**
 * `GET /lilly/actions/{chave}` (Maturacao/59, 6.2 e D4/D9). Sempre 200 (4xx no GET vira exceção na Lilly):
 *  - confirmada            -> { committed:true, result, context? }
 *  - nunca vista/recusada  -> { committed:false, state:'not_executed' }
 *  - em_execucao antiga ou incerta -> { committed:false, state:'uncertain' }
 *  - em_execucao recente   -> { committed:false, state:'pending' }
 * Ação só-Umbler nunca tem linha aqui: volta 'not_executed' (a conferência na Umbler é humana, D9).
 */

const { normalizarChave } = require('../idempotencia/chave');
const repo = require('../dados/acoes.repo');
const { avulso } = require('../dados/executor');

const SEGUNDOS_ATE_INCERTA = 120;
const segundosAteIncerta = (env = process.env) => {
  const n = Number(env.LILLY_ACAO_INCERTA_APOS_S);
  return Number.isFinite(n) && n >= 0 ? n : SEGUNDOS_ATE_INCERTA;
};

/**
 * @param {string} chaveBruta chave original (já decodificada)
 * @param {{ executor?: object, agora?: Date, montarContexto?: Function }} [op]
 */
async function conciliar(chaveBruta, { executor = avulso, agora = new Date(), montarContexto } = {}) {
  const chave = normalizarChave(chaveBruta);
  if (!chave) return null;
  const acao = await repo.lerAcao(executor, chave.interna);
  if (!acao || acao.estado === 'recusada') return { committed: false, state: 'not_executed' };
  if (acao.estado === 'confirmada') {
    const context = montarContexto ? await montarContexto(acao) : undefined;
    return { committed: true, result: acao.resultado ?? {}, ...(context ? { context } : {}) };
  }
  if (acao.estado === 'incerta') return { committed: false, state: 'uncertain' };
  const idadeS = (agora.getTime() - new Date(acao.atualizadoEm).getTime()) / 1000;
  return { committed: false, state: idadeS > segundosAteIncerta() ? 'uncertain' : 'pending' };
}

module.exports = { conciliar, segundosAteIncerta };
