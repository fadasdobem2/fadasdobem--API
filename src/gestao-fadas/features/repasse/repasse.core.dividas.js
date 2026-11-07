'use strict';

/** Dívidas (R17), fora do saldo de comissões: saldo devedor, correção e parcela sugerida. */

const { moneyToCents, centsToMoney } = require('./helpers/dinheiro');
const { ZERO, compareText, nonNegative, minCents } = require('./repasse.core.util');
const { civilDate } = require('./repasse.core.calendario');

// ---- Dívidas (R17): fora do saldo de comissões ----

/** A dívida e as linhas que ela substitui pelo corrects: a correção herda os descontos já registrados na cadeia. */
function debtChain(debt, byId) {
  const ids = new Set([debt.id]);
  for (let id = debt.corrects; id !== null && !ids.has(id); id = (byId.get(id) && byId.get(id).corrects) ?? null) ids.add(id);
  return ids;
}

/** Descontos de parcela de pagamentos válidos para a cadeia; through null conta todos, sem limite de data. */
function deductedCents(transfers, ids, through) {
  let total = ZERO;
  for (const transfer of transfers) {
    if (transfer.status !== 'valido' || (through !== null && transfer.paidOn > through)) continue;
    for (const item of transfer.deductions) if (ids.has(item.debtId)) total += moneyToCents(item.amount);
  }
  return total;
}

/** Data de entrega para ordenar: a real na dívida nova; na de migração, a entrega original ou a referência. */
function debtSortDate(debt) {
  return (debt.origin === 'novo' ? debt.deliveredOn : debt.originalDeliveryOn ?? debt.referenceDate) ?? '';
}

/** Na mesma data, a de migração é a mais antiga: foi entregue antes do corte, e a nova, depois dele. */
function compareDebtAge(a, b) {
  return compareText(debtSortDate(a), debtSortDate(b)) || Number(a.origin === 'novo') - Number(b.origin === 'novo') || compareText(a.id, b.id);
}

/**
 * Dívidas válidas já existentes em D, da mais antiga para a mais nova: a nova a partir da entrega, a de migração sempre,
 * porque foi entregue antes do corte. O saldo devedor desconta os pagamentos válidos até D; o já recuperado, usado na
 * parcela sugerida, conta todos, como o loanBalance da v584, para não sugerir de novo um desconto lançado com data posterior.
 */
function debtLedger(debts, transfers, date, include) {
  const byId = new Map(debts.map((item) => [item.id, item]));
  return debts
    .filter((item) => item.status === 'valido' && (item.origin === 'migracao' || (item.deliveredOn !== null && item.deliveredOn <= date)) && include(item))
    .sort(compareDebtAge)
    .map((debt) => {
      const chain = debtChain(debt, byId);
      const amount = moneyToCents(debt.amount);
      return { debt, balance: nonNegative(amount - deductedCents(transfers, chain, date)), recovered: deductedCents(transfers, chain, null) };
    });
}

/** Saldo devedor de cada dívida em D: o valor menos os descontos de pagamentos válidos até D. */
function debtBalances(debts, transfers, date) {
  civilDate(date);
  return debtLedger(debts, transfers, date, () => true)
    .map(({ debt, balance }) => ({ debtId: debt.id, kind: debt.kind, origin: debt.origin, balance: centsToMoney(balance) }));
}

/** A correção de uma dívida não pode ficar abaixo do que já foi descontado dela, sem limite de data. Igual é aceito. */
function checkDebtCorrection(debts, transfers, debtId, amount) {
  const byId = new Map(debts.map((item) => [item.id, item]));
  const debt = byId.get(debtId);
  if (!debt) throw new Error(`Dívida inexistente: ${debtId}`);
  const deducted = deductedCents(transfers, debtChain(debt, byId), null);
  return moneyToCents(amount) < deducted ? { ok: false, reason: 'below-deducted', deducted: centsToMoney(deducted) } : { ok: true };
}

/**
 * Parcela sugerida, como o suggestedLoanDeductions e o payoutLoanDueAmount da v584: por dívida, as parcelas com data
 * até D menos o já recuperado, limitadas ao saldo devedor, da mais antiga para a mais nova e até o valor a pagar. As
 * datas das parcelas são as acordadas; o calendário de pagamento não entra. A sugestão não baixa a dívida.
 */
function suggestedDeductions(ledger, date, available) {
  const result = [];
  let left = available;
  for (const { debt, recovered } of ledger) {
    const scheduled = debt.installments.reduce((total, item) => (item.date <= date ? total + moneyToCents(item.amount) : total), ZERO);
    const amount = minCents(nonNegative(moneyToCents(debt.amount) - recovered), nonNegative(scheduled - recovered), left);
    left -= amount;
    if (amount > ZERO) result.push({ debtId: debt.id, amount: centsToMoney(amount) });
  }
  return result;
}

module.exports = { debtLedger, debtBalances, checkDebtCorrection, suggestedDeductions };
