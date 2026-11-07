'use strict';

/** Linha de A pagar em D (contracts/payouts-http.md). */

const { moneyToCents, centsToMoney, sumCents } = require('./helpers/dinheiro');
const { ZERO } = require('./repasse.core.util');
const { expectedPayment } = require('./repasse.core.calendario');
const { debtLedger, suggestedDeductions } = require('./repasse.core.dividas');
const { openingFlag, confirmedOpening, operationalToday, pendingCancellations, settledNotice, compositionLines, compositionTotals, pendingPeriod } = require('./repasse.core.apuracao');

/**
 * Linha de A pagar em D (contracts/payouts-http.md). Sem abertura confirmada não há valor (FR-030), mas o saldo
 * devedor, os cancelamentos pendentes e a data prevista seguem visíveis. Dívida de migração só conta pela abertura
 * vigente confirmada; a de outra revisão ou do rascunho fica fora. Com D antes do fim do período quitado, a linha também
 * sai sem valor, com o aviso "quitado até", e os demais tarólogos seguem normais na mesma data (PO, 2026-10-24).
 */
function buildDueRow(input, date, nowLocal) {
  const expected = expectedPayment(input.schedule, date);
  const today = operationalToday(nowLocal);
  const opening = input.opening;
  const confirmed = confirmedOpening(opening);
  const ledger = debtLedger(input.debts, input.transfers, date, (debt) => debt.origin === 'novo' || (confirmed !== null && debt.openingId === confirmed.id));
  const common = {
    tarotId: input.tarotId, name: input.name, expectedDate: expected.date, expectedDateIssue: expected.issue,
    debtBalance: centsToMoney(ledger.reduce((total, item) => total + item.balance, ZERO)),
    pendingCancellationCount: pendingCancellations(input, confirmed, date, today), divergenceCount: input.divergenceCount, opening: openingFlag(opening),
  };
  const settledThrough = confirmed && settledNotice(confirmed, date);
  if (confirmed === null || settledThrough !== null) {
    return { ...common, period: null, due: null, suggestedDeductions: [], net: null, pendingReviewCount: 0, settledThrough };
  }
  const lines = compositionLines(input, confirmed, date, today);
  const totals = compositionTotals(lines, common.pendingCancellationCount);
  const due = moneyToCents(totals.due);
  const suggested = suggestedDeductions(ledger, date, due);
  const net = due - sumCents(suggested.map((item) => item.amount));
  return {
    ...common, period: pendingPeriod(lines), due: totals.due, suggestedDeductions: suggested, net: centsToMoney(net),
    pendingReviewCount: totals.pendingReviewCount, settledThrough: null,
  };
}

module.exports = { buildDueRow };
