'use strict';

/**
 * Correção de tempo na rota da consulta (Maturacao/35): o servidor REFAZ a correção (`consulta-correcao.js`, porte de
 * `correctConsultationTime`) a partir do registro que ele guarda, com o saldo real da cliente (`ciclo.financeiro.js`), e confere que o
 * resultado do navegador tem os mesmos efeitos (situação, tempos, revisão financeira, correções). O registro gravado leva o cálculo e os
 * instantes do servidor. Recusa de saldo ou de regra = 422 com a frase do front.
 */

const corr = require('../../_comum/dominio/consulta-correcao');
const { RegraConsultaError } = require('../../_comum/dominio/consulta-comum');
const { estavel } = require('../financeiro-cliente/fin.comum');
const financeiro = require('./ciclo.financeiro');

const CAMPOS = ['status', 'durationSeconds', 'performedDurationSeconds', 'financialReview', 'finishReview', 'finishCorrections', 'readerCorrection'];
const MSG_DIFERENTE = 'Não foi possível conferir esta correção de tempo. Atualize a tela e tente novamente.';
const recorte = (i) => ({ ...Object.fromEntries(CAMPOS.map((c) => [c, i[c]])), minutosRelatados: i.tarologistFinishReport && i.tarologistFinishReport.minutes, tetoFinanceiro: i.tarologistFinishReport && i.tarologistFinishReport.financialCap && i.tarologistFinishReport.financialCap.minutes });

/** Devolve o registro com a correção refeita no servidor (instante `agora`), ou `null` quando o pedido não é uma correção do tipo `readerCorrection`. */
async function refazer(ex, antes, pedido, versao, agora) {
  const lido = corr.lerPedidoDeCorrecao(antes, pedido);
  if (!lido) return null;
  const fin = await financeiro.contexto(ex, antes);
  const clone = () => JSON.parse(JSON.stringify(antes));
  const comoOFront = corr.corrigirTempo(clone(), lido.minutos, lido.motivo, lido.ator, lido.em, versao, fin);
  if (estavel(recorte(comoOFront)) !== estavel(recorte(pedido))) throw new RegraConsultaError(MSG_DIFERENTE);
  const feito = corr.corrigirTempo(clone(), lido.minutos, lido.motivo, lido.ator, agora, versao, fin);
  return { ...pedido, ...Object.fromEntries(CAMPOS.map((c) => [c, feito[c]])), ...(feito.tarologistFinishReport ? { tarologistFinishReport: { ...(pedido.tarologistFinishReport || feito.tarologistFinishReport), minutes: feito.tarologistFinishReport.minutes, ...(feito.tarologistFinishReport.financialCap ? { financialCap: feito.tarologistFinishReport.financialCap } : {}) } } : {}), audit: feito.audit, updatedAt: agora };
}

module.exports = { refazer, MSG_DIFERENTE };
