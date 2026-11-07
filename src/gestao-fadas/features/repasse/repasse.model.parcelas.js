'use strict';

/** Parcelas de uma dívida da migração: datas, divisão em centavos e edição. */

const { moneyToCents, centsToMoney, sumMoney } = require('./helpers/dinheiro');
const { isAgendaDate, shiftDateKey } = require('./helpers/datas');
const { nextScheduledPayment } = require('./helpers/calendario-pagamento');
const { moneyFromField, moneyToField } = require('./repasse.model.dinheiro');

const ZERO = 0n;
const MAX_PAYOUT_LOAN_INSTALLMENTS = 1000;
const payoutLoanFrequencyLabels = { payment: 'A cada pagamento', weekly: 'Semanal', monthly: 'Mensal', custom: 'Datas escolhidas' };

const blankDebt = (key, firstDate = '') =>
  ({ key, kind: 'advance', remaining: '', originalDeliveryOn: '', sheetRef: '', count: '1', frequency: 'payment', firstDate, edited: null });

const scheduleFieldKey = (schedule) => JSON.stringify(schedule);
// As parcelas editadas valem enquanto o valor, a quantidade, o início e a frequência forem os mesmos, e o calendário
// também, quando é dele que saem as datas ("A cada pagamento").
const planKey = (debt, schedule) =>
  JSON.stringify([debt.remaining, debt.count, debt.firstDate, debt.frequency, debt.frequency === 'payment' ? scheduleFieldKey(schedule) : null]);

// As datas da programação, como o editor aprovado v553 as gera, sem o valor.
function planDates(count, firstDate, frequency, schedule) {
  const dates = [];
  const year = Number(firstDate.slice(0, 4));
  const month = Number(firstDate.slice(5, 7)) - 1;
  const anchorDay = Number(firstDate.slice(8, 10));
  let paymentDate = firstDate;
  for (let index = 0; index < count; index++) {
    if (frequency === 'custom') dates.push(index === 0 ? firstDate : '');
    else if (frequency === 'weekly') dates.push(shiftDateKey(firstDate, index * 7));
    else if (frequency === 'monthly') {
      const alvo = new Date(`${firstDate}T12:00:00Z`);
      alvo.setUTCFullYear(year, month + index + 1, 0);
      alvo.setUTCDate(Math.min(anchorDay, alvo.getUTCDate()));
      dates.push(alvo.toISOString().slice(0, 10));
    } else {
      const proxima = schedule ? nextScheduledPayment(schedule, paymentDate) : null;
      if (!proxima) return null;
      dates.push(proxima);
      paymentDate = shiftDateKey(proxima, 1);
    }
  }
  return dates;
}

/** As parcelas na tela: as editadas, ou as geradas dividindo o restante em centavos, com o centavo a mais nas últimas. */
function debtPlan(debt, schedule) {
  const remaining = moneyFromField(debt.remaining);
  const count = Number(debt.count);
  let rows = [];
  let error = null;
  if (debt.edited && debt.edited.plan === planKey(debt, schedule)) rows = debt.edited.rows;
  else if (remaining === null || moneyToCents(remaining) <= ZERO) error = 'Informe o valor que faltava devolver para conferir as parcelas.';
  else if (!Number.isInteger(count) || count < 1 || count > MAX_PAYOUT_LOAN_INSTALLMENTS) error = `Informe de 1 a ${MAX_PAYOUT_LOAN_INSTALLMENTS} parcelas.`;
  else if (BigInt(count) > moneyToCents(remaining)) error = 'Cada parcela precisa ter pelo menos R$ 0,01.';
  else if (!isAgendaDate(debt.firstDate)) error = 'Escolha a data do primeiro desconto.';
  else {
    const dates = planDates(count, debt.firstDate, debt.frequency, schedule);
    if (dates === null) error = 'Não foi possível definir todas as datas pelo calendário de pagamento. Escolha Datas escolhidas e informe as datas combinadas.';
    else {
      const total = moneyToCents(remaining);
      const size = BigInt(count);
      const base = total / size;
      const extra = Number(total % size);
      rows = dates.map((date, index) => ({ date, amount: moneyToField(centsToMoney(base + (index >= count - extra ? 1n : ZERO))) }));
    }
  }
  const amounts = rows.map((row) => moneyFromField(row.amount));
  const total = amounts.every((a) => a !== null) ? sumMoney(amounts) : null;
  return { rows, error, total, remaining, balanced: total !== null && remaining !== null && total === remaining };
}

/** Uma data ou um valor de parcela editado, como no editor v553: mudar uma data passa a "Datas escolhidas". */
function editInstallment(debt, schedule, index, field, valor) {
  const rows = debtPlan(debt, schedule).rows.map((row, at) => (at === index ? { ...row, [field]: valor } : { ...row }));
  const next = field === 'date' ? { ...debt, frequency: 'custom', firstDate: index === 0 ? valor : debt.firstDate } : debt;
  return { ...next, edited: { plan: planKey(next, schedule), rows } };
}

/** A frequência escolhida: "Datas escolhidas" mantém as parcelas da tela para editar; as outras geram de novo. */
function chooseFrequency(debt, schedule, frequency) {
  const rows = debtPlan(debt, schedule).rows;
  const next = { ...debt, frequency };
  if (frequency === 'custom' && rows.length) return { ...next, edited: { plan: planKey(next, schedule), rows: rows.map((row) => ({ ...row })) } };
  return frequency === debt.frequency ? next : { ...next, edited: null };
}

module.exports = { MAX_PAYOUT_LOAN_INSTALLMENTS, payoutLoanFrequencyLabels, blankDebt, planKey, debtPlan, editInstallment, chooseFrequency };
