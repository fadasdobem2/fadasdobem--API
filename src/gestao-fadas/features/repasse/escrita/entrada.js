'use strict';

/** Do corpo validado para a entrada do store (porte de `openingInput` e `agreementWrite` de real-payouts-http.server.ts). */

const { saoPauloTimestamp } = require('../helpers/datas');

// O store guarda o instante local com espaço, como o DATETIME; a rota fala com "T".
const paraGuardado = (local) => local.replace('T', ' ');

/** Vigência de um acordo: o agora de São Paulo, ao segundo, seja qual for o fuso do servidor. */
const vigenciaAgora = (agora = new Date()) => paraGuardado(saoPauloTimestamp(agora));

/** O corpo do contrato nos campos do store. Um ajuste em aberto tem só a data, e o período dele é essa data. */
function entradaDaAbertura(corpo, ator) {
  return {
    operationKey: corpo.operationKey, actor: ator, tarotId: corpo.tarotId,
    lastPayment: corpo.lastPayment, settledThrough: paraGuardado(corpo.settledThrough), remainingBalance: corpo.remainingBalance,
    balanceNote: corpo.remainingBalanceNote ?? null, migrationCut: paraGuardado(corpo.migrationCut), rate: corpo.rate,
    differences: corpo.differences.map((d) => ({ description: d.description, amount: d.amount ?? null })),
    debts: corpo.debts.map((d) => ({
      kind: d.kind, amount: d.remaining, originalDeliveryOn: d.originalDeliveryOn ?? null, sheetRef: d.sheetRef, note: null, installments: d.installments,
    })),
    adjustments: corpo.openAdjustments.map((a) => ({ ...a, periodStart: a.date, periodEnd: a.date })),
  };
}

module.exports = { paraGuardado, vigenciaAgora, entradaDaAbertura };
