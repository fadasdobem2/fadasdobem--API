'use strict';

/**
 * Crédito restante de um pagamento no servidor (Maturacao/42): porte de `features/finance/payment-credit-refund.ts`
 * (`paymentRemainingCredit`, `refundCreditSnapshot`, `recordRemainingCreditRefund`). O crédito vem de `tarifaDeCredito`
 * (`financeiro-saldo.js`, porte de `clientCreditTariff` com ouro financeiro), com o contexto REAL da cliente lido do Postgres.
 */

const saldo = require('./financeiro-saldo');
const L = require('./pagamentos-livro');
const { registrarMovimento } = require('./pagamentos-movimento');

const { erro, centavos, arredondar } = L;
const exatos = (v) => Math.round(Math.max(0, v) * 1e8) / 1e8;

/** `paymentRemainingCredit(payment, { payments, consultations, profile }, at)`: o recibo escolhido é dono deste saldo. */
function creditoRestante(p, contexto, em) {
  const pagamentos = [...contexto.payments.filter((x) => x.id !== p.id), p];
  const tarifa = saldo.tarifaDeCredito(p.clientId, em, undefined, contexto.consultations, pagamentos, contexto.profile);
  const lotes = tarifa.availableLots.filter((l) => l.paymentId === p.id);
  const cents = lotes.reduce((s, l) => s + l.cents, 0);
  const minutos = exatos(lotes.reduce((s, l) => s + l.minutes, 0));
  const unitario = minutos > 0 ? lotes.reduce((s, l) => s + l.minutes * l.unitValue, 0) / minutos : p.purchase && p.purchase.minutes > 0 ? p.purchase.amount / p.purchase.minutes : p.cashUnitValue || 0;
  const minutosConhecidos = lotes.every((l) => l.minutesKnown !== false);
  return { amount: cents / 100, minutes: minutosConhecidos ? minutos : 0, unitValue: minutosConhecidos ? unitario : 0, minutesKnown: minutosConhecidos };
}

/** `refundCreditSnapshot(before, creditAmount, unitValue)`. */
function retratoDoCredito(antes, valorCredito, unitario) {
  const valor = arredondar(valorCredito);
  if (!Number.isFinite(valor) || valor <= 0 || centavos(valor) > centavos(antes.amount)) erro('O valor ultrapassa o crédito disponível deste pagamento. O saldo já utilizado ou reservado não pode ser devolvido como crédito restante.');
  if (!Number.isFinite(antes.minutes) || antes.minutes <= 0 || !Number.isFinite(unitario) || unitario <= 0) erro('Confira os minutos e o valor da compra antes de devolver este crédito.');
  const retirado = centavos(valor) === centavos(antes.amount) ? antes.minutes : Math.min(antes.minutes, valor / unitario);
  return { source: 'remaining-credit', unitValue: unitario, minutesEffect: -exatos(retirado), before: { minutes: exatos(antes.minutes), amount: arredondar(antes.amount) }, after: { minutes: exatos(antes.minutes - retirado), amount: arredondar(antes.amount - valor) } };
}

/** `recordRemainingCreditRefund(payment, input, context, actor, id, recordedAt)`. */
function devolverCreditoRestante(p, entrada, contexto, ator, id, registradoEm) {
  if ((p.movements || []).some((m) => m.creditSnapshot && Date.parse(m.occurredAt) > Date.parse(entrada.occurredAt))) erro('Já há uma devolução de crédito posterior a essa data. Confira a ordem dos estornos antes de registrar um movimento retroativo.');
  const antes = creditoRestante(p, contexto, entrada.occurredAt);
  const agora = creditoRestante(p, contexto, registradoEm);
  if (centavos(entrada.amount) > centavos(agora.amount)) erro('O valor ultrapassa o crédito disponível agora. O saldo já utilizado ou reservado não pode ser devolvido como crédito restante.');
  const retrato = retratoDoCredito(antes, entrada.amount, antes.unitValue);
  const valorBanco = entrada.bankAmount === undefined || entrada.bankAmount === null ? entrada.amount : entrada.bankAmount;
  const proximo = registrarMovimento(p, { ...entrada, kind: 'refund', bankMoved: true, amount: valorBanco, creditAmount: entrada.amount }, ator, id, registradoEm);
  return { ...proximo, movements: proximo.movements.map((m) => (m.id === id ? { ...m, creditSnapshot: retrato } : m)) };
}

module.exports = { creditoRestante, retratoDoCredito, devolverCreditoRestante };
