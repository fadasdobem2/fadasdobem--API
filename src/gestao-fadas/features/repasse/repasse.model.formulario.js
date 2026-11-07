'use strict';

/** Formulário da abertura: campos em branco, partida de uma correção e frases de apoio. */

const { shiftDateKey } = require('./helpers/datas');
const { moneyToField } = require('./repasse.model.dinheiro');
const { rateFieldValue } = require('./repasse.model.acordo');
const { planKey } = require('./repasse.model.parcelas');

const blankAdjustment = (key) => ({ key, kind: 'bonus', date: '', amount: '', description: '' });
const blankDifference = (key) => ({ key, description: '', amount: '' });

/** O formulário de uma abertura nova: o corte às 6h de hoje (D5) e o percentual em vigor. */
const blankForm = ({ today, rate }) => ({
  lastPaidOn: '', lastAmount: '', lastSheetRef: '', settledDay: '', migrationCut: `${today}T06:00`, rate: rateFieldValue(rate),
  balance: '', balanceNote: '', adjustments: [], debts: [], differences: [], reason: '',
});

/** As dívidas que a revisão mostra: sem as que uma correção na mesma revisão substituiu, na ordem em que vieram. */
const liveDebts = (opening) => opening.debts.filter((debt) => !opening.debts.some((outra) => outra.corrects === debt.id));

/** A correção parte da revisão como foi gravada, com as dívidas na mesma ordem, que a correção pareia por posição. */
function formFromOpening(opening) {
  return {
    lastPaidOn: opening.lastPayment.paidOn, lastAmount: moneyToField(opening.lastPayment.amount), lastSheetRef: opening.lastPayment.sheetRef,
    settledDay: shiftDateKey(opening.settledThrough.slice(0, 10), -1), migrationCut: opening.migrationCut.slice(0, 16), rate: rateFieldValue(opening.rate),
    balance: moneyToField(opening.remainingBalance), balanceNote: opening.remainingBalanceNote ?? '',
    adjustments: opening.openAdjustments.map((item) => ({ key: item.id, kind: item.kind, date: item.date, amount: moneyToField(item.amount.replace('-', '')), description: item.description })),
    debts: liveDebts(opening).map((debt) => {
      const form = {
        key: debt.id, kind: debt.kind, remaining: moneyToField(debt.remaining), originalDeliveryOn: debt.originalDeliveryOn ?? '', sheetRef: debt.sheetRef,
        count: String(debt.installments.length), frequency: 'custom', firstDate: (debt.installments[0] && debt.installments[0].date) ?? '', edited: null,
      };
      return { ...form, edited: { plan: planKey(form, null), rows: debt.installments.map((item) => ({ date: item.date, amount: moneyToField(item.amount) })) } };
    }),
    differences: opening.differences.map((item) => ({ key: item.id, description: item.description, amount: item.amount === null ? '' : moneyToField(item.amount) })),
    reason: '',
  };
}

const shortDay = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** A frase ao lado do último dia operacional quitado. */
const settledThroughLabel = (settledDay) => `Consultas iniciadas até ${shortDay(shiftDateKey(settledDay, 1))} às 6h estão quitadas.`;


module.exports = { blankAdjustment, blankDifference, blankForm, liveDebts, formFromOpening, shortDay, settledThroughLabel };
