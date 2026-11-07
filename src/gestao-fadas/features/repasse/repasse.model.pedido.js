'use strict';

/** Corpo do contrato para lançar ou corrigir uma abertura, com a validação do formulário. */

const { moneyToCents } = require('./helpers/dinheiro');
const { isAgendaDate, shiftDateKey } = require('./helpers/datas');
const { moneyFromField } = require('./repasse.model.dinheiro');
const { rateFromField } = require('./repasse.model.acordo');
const { debtPlan } = require('./repasse.model.parcelas');

const ZERO = 0n;

const refuse = (problem) => ({ problem });
const trimmed = (texto, max) => {
  const valor = texto.trim();
  return valor.length > 0 && valor.length <= max ? valor : null;
};

/**
 * O corpo do contrato para lançar ou corrigir, sem `operationKey`, ou o que falta, com as regras que o servidor confere
 * de novo: o período quitado antes do corte, o saldo presente (mesmo zero), as parcelas de cada dívida somando o restante
 * e nenhuma antes do dia do corte (D8). O desconto em aberto vai negativo, como o valor com sinal do data-model.
 */
function openingRequest(form, { tarotId, correcting, schedule = null }) {
  const reason = correcting ? trimmed(form.reason, 500) : null;
  if (correcting && reason === null) return refuse('Informe o motivo da correção, com até 500 caracteres.');
  const lastAmount = moneyFromField(form.lastAmount);
  if (!isAgendaDate(form.lastPaidOn) || lastAmount === null) return refuse('Informe a data e o valor do último pagamento.');
  const lastSheetRef = trimmed(form.lastSheetRef, 200);
  if (lastSheetRef === null) return refuse('Informe a linha da planilha do último pagamento.');
  if (!isAgendaDate(form.settledDay)) return refuse('Informe o último dia operacional quitado.');
  const migrationCut = `${form.migrationCut}:00`;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(form.migrationCut) || !isAgendaDate(form.migrationCut.slice(0, 10))) return refuse('Informe a data e a hora do corte da migração.');
  const settledThrough = `${shiftDateKey(form.settledDay, 1)}T06:00:00`;
  if (settledThrough >= migrationCut) return refuse('O período quitado precisa terminar antes do corte da migração.');
  const rate = rateFromField(form.rate);
  if (rate === null) return refuse('Informe o percentual conferido entre 0 e 100, com até duas casas decimais.');
  const remainingBalance = moneyFromField(form.balance, { signed: true });
  if (remainingBalance === null) return refuse('Informe o saldo remanescente, mesmo que seja 0,00.');
  const balanceNote = form.balanceNote.trim();
  if (balanceNote.length > 2000) return refuse('A origem do saldo tem até 2000 caracteres.');

  const openAdjustments = [];
  for (const [index, item] of form.adjustments.entries()) {
    const amount = moneyFromField(item.amount);
    const description = trimmed(item.description, 500);
    if (!isAgendaDate(item.date) || amount === null || moneyToCents(amount) <= ZERO || description === null) return refuse(`Confira a data, o valor e a descrição do ajuste ${index + 1}.`);
    openAdjustments.push({ kind: item.kind, amount: item.kind === 'desconto' ? `-${amount}` : amount, description, date: item.date });
  }

  const cutDay = form.migrationCut.slice(0, 10);
  const debts = [];
  for (const [index, debt] of form.debts.entries()) {
    const label = `${debt.kind === 'loan' ? 'do empréstimo' : 'do adiantamento'} ${index + 1}`;
    const plan = debtPlan(debt, schedule);
    if (plan.remaining === null || moneyToCents(plan.remaining) <= ZERO) return refuse(`Informe o valor que faltava devolver ${label}.`);
    const sheetRef = trimmed(debt.sheetRef, 200);
    if (sheetRef === null) return refuse(`Informe a linha da planilha ${label}.`);
    if (debt.originalDeliveryOn && !isAgendaDate(debt.originalDeliveryOn)) return refuse(`Confira a data original da entrega ${label}.`);
    if (!plan.rows.length) return refuse(plan.error ?? `Programe as parcelas ${label}.`);
    const installments = [];
    for (const [at, row] of plan.rows.entries()) {
      const amount = moneyFromField(row.amount);
      if (!isAgendaDate(row.date) || amount === null || moneyToCents(amount) <= ZERO) return refuse(`Confira a data e o valor da parcela ${at + 1} ${label}.`);
      if (row.date < cutDay) return refuse(`A parcela ${at + 1} ${label} não pode ser antes do dia do corte da migração.`);
      installments.push({ date: row.date, amount });
    }
    if (!plan.balanced) return refuse(`A soma das parcelas ${label} precisa ser igual ao valor que faltava devolver.`);
    debts.push({ kind: debt.kind, remaining: plan.remaining, originalDeliveryOn: debt.originalDeliveryOn || null, sheetRef, installments });
  }

  const differences = [];
  for (const [index, item] of form.differences.entries()) {
    const description = trimmed(item.description, 500);
    const amount = item.amount.trim() ? moneyFromField(item.amount, { signed: true }) : null;
    if (description === null || (item.amount.trim() && amount === null)) return refuse(`Confira a descrição e o valor da diferença ${index + 1}.`);
    differences.push({ description, amount });
  }

  return {
    fields: {
      tarotId, lastPayment: { paidOn: form.lastPaidOn, amount: lastAmount, sheetRef: lastSheetRef },
      settledThrough, remainingBalance, remainingBalanceNote: balanceNote || null, migrationCut, rate,
      openAdjustments, debts, differences, ...(reason === null ? {} : { reason }),
    },
  };
}

module.exports = { openingRequest };
