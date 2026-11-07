'use strict';

/** Leitura de uma revisão da abertura: etiqueta, totais do resumo e rótulos de data. */

const { sumMoney } = require('./helpers/dinheiro');
const { saoPauloTimestamp, dateKeyLabel } = require('./helpers/datas');
const { liveDebts, shortDay } = require('./repasse.model.formulario');

function revisionTag(opening, current) {
  if (opening.status === 'descartada') return 'Descartada';
  if (opening.status === 'rascunho') return 'Rascunho';
  return current && current.id === opening.id ? 'Vigente' : 'Substituída';
}

/** Os quatro cartões do resumo: o saldo, os adicionais e os descontos em aberto e as dívidas a recuperar. */
function openingTotals(opening) {
  const valores = opening.openAdjustments.map((item) => item.amount);
  return {
    balance: opening.remainingBalance,
    additions: sumMoney(valores.filter((v) => !v.startsWith('-'))),
    discounts: sumMoney(valores.filter((v) => v.startsWith('-')).map((v) => v.slice(1))),
    debts: sumMoney(liveDebts(opening).map((debt) => debt.remaining)),
  };
}

/** Um instante local do contrato ("2026-10-24T06:00:00") como "24/10/2026 06:00". */
const localMomentText = (local) => `${dateKeyLabel(local.slice(0, 10))} ${local.slice(11, 16)}`;
/** Um instante UTC da resposta como a tela o diz, em São Paulo: "24/10/2026 14:32". */
const momentLabel = (iso) => localMomentText(saoPauloTimestamp(new Date(iso)));
/** O fim do período quitado como a tela o diz: "Quitado até 20/10 às 6h". */
const settledThroughText = (settledThrough) => `${shortDay(settledThrough.slice(0, 10))} às 6h`;

module.exports = { revisionTag, openingTotals, localMomentText, momentLabel, settledThroughText };
