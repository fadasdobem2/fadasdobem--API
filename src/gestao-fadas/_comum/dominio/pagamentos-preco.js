'use strict';

/**
 * Preço da compra de minutos no servidor (Maturacao/42, item 4): porte de `domain/pricing.ts` (`priceOptions`, `recognizePurchase`, `validatePurchase`,
 * `resolvePurchase`, `regularMinuteValue`) e de `finance/payment-pricing-reference.ts` (`paymentPricingReference`: o valor de referência que a TELA
 * escolhe), com a tabela de preços REAL (`gf_precos_versoes` + base VAL-001) e o histórico REAL da cliente (primeira consulta). O servidor passa a REFAZER a
 * escolha e conferir; nunca aceita a compra do navegador por palavra. `resolveConsultationTariff` sem contrato (só o que a referência usa) = `tarifaSemContrato`.
 */

const b = require('./financeiro-base');
const L = require('./pagamentos-livro');

const { erro, centavos } = L;
const valorRegular = (pricing) => b.valorDoMinuto(pricing);

function opcoesDePreco(pricing) {
  return [...pricing.firstConsultationPrices.map((o) => ({ ...o, table: 'first' })), ...pricing.regularPrices.map((o) => ({ ...o, table: 'regular' }))];
}
/** `recognizePurchase`: só reconhece o valor que bate com UMA opção da tabela. */
function reconhecerCompra(valor, pricing) {
  const cents = centavos(valor);
  const iguais = opcoesDePreco(pricing).filter((o) => centavos(o.price) === cents);
  if (iguais.length !== 1) return undefined;
  return { minutes: iguais[0].minutes, amount: valor, table: iguais[0].table, priceVersionId: pricing.id };
}
/** `validatePurchase`. */
function validarCompra(compra, valor) {
  if (!Number.isSafeInteger(compra.minutes) || compra.minutes < 1 || !['first', 'regular', 'custom'].includes(compra.table) || !Number.isFinite(compra.amount) || centavos(compra.amount) !== centavos(valor)) erro('Confira os minutos comprados e o valor da compra.');
  return { ...compra, amount: valor };
}
/** `resolvePurchase(amount, pricing, previous, explicit)`. */
function resolverCompra(valor, pricing, anterior, explicita) {
  if (explicita) return validarCompra(explicita, valor);
  if (anterior && centavos(anterior.amount) === centavos(valor)) return { ...anterior };
  const reconhecida = reconhecerCompra(valor, pricing);
  if (reconhecida) return reconhecida;
  if (anterior) return { minutes: anterior.minutes, amount: valor, table: 'custom' };
  return undefined;
}
/** `purchaseForMethod`. */
function compraDaForma(valor, pricing, forma, explicita) {
  if (explicita && explicita.table === 'first' && forma !== 'PIX') erro('O valor de primeira consulta é exclusivo para Pix.');
  const compra = resolverCompra(valor, pricing, undefined, explicita);
  return compra && compra.table === 'first' && forma !== 'PIX' ? undefined : compra;
}

/** `resolveConsultationTariff({ clientId, at }, context)` SEM contrato, cobertura nem consulta: a tarifa que a referência de pagamento usa. */
function tarifaSemContrato(clientId, em, contexto) {
  const pricing = b.precoVigente(contexto.history, em);
  const { first } = b.elegibilidadePrimeira(clientId, em, contexto.consultations, contexto.profiles[clientId], pricing.firstConsultationWindowHours, undefined);
  const opcoes = first ? pricing.firstConsultationPrices : pricing.regularPrices;
  if (!first) return { table: 'regular', unitValue: valorRegular(pricing) };
  const opcao = opcoes.find((p) => p.minutes === pricing.minimumMinutes) || opcoes[0];
  return { table: 'first', unitValue: opcao.price / opcao.minutes };
}

/** `paymentPricingReference(amount, clientId, at, pricing, context, editing, method)`: `{ purchase, cashUnitValue, unitValue }`. */
function referenciaDePreco(valor, clientId, em, pricingPadrao, contexto, editando, forma = 'PIX') {
  if (editando) em = editando.paidAt || editando.informedAt || em;
  const soData = /^\d{4}-\d{2}-\d{2}$/.test(em);
  const emDoPreco = soData ? `${em}T12:00:00-03:00` : em;
  const pricing = b.precoVigente(contexto.history.length ? contexto.history : [pricingPadrao], emDoPreco);
  if (editando) {
    if (valor === editando.amount && forma === editando.method) return { purchase: editando.purchase, cashUnitValue: editando.cashUnitValue, unitValue: editando.cashUnitValue || (editando.purchase ? editando.purchase.amount / editando.purchase.minutes : tarifaSemContrato(clientId, em, contexto).unitValue) };
    if (editando.cashUnitValue && forma === editando.method) return { purchase: undefined, cashUnitValue: editando.cashUnitValue, unitValue: editando.cashUnitValue };
  }
  const momentos = soData ? [`${em}T00:00:00-03:00`, `${em}T23:59:59-03:00`] : [em];
  const primeira = forma === 'PIX' && Boolean(clientId) && momentos.every((m) => tarifaSemContrato(clientId, m, contexto).table === 'first');
  const opcoes = primeira ? pricing.firstConsultationPrices : pricing.regularPrices;
  const base = opcoes.find((o) => o.minutes === pricing.minimumMinutes) || opcoes[0];
  const daPrimeira = primeira ? pricing.firstConsultationPrices.find((o) => centavos(o.price) === centavos(valor)) : undefined;
  const achada = daPrimeira || pricing.regularPrices.find((o) => centavos(o.price) === centavos(valor));
  const compra = achada ? { amount: valor, minutes: achada.minutes, table: daPrimeira ? 'first' : 'regular', priceVersionId: pricing.id } : undefined;
  const taxaRegistrada = editando && forma === editando.method ? (editando.cashUnitValue || (editando.purchase ? editando.purchase.amount / editando.purchase.minutes : undefined)) : undefined;
  const unitario = compra ? compra.amount / compra.minutes : taxaRegistrada || (primeira ? base.price / base.minutes : valorRegular(pricing));
  return { purchase: compra, cashUnitValue: compra ? undefined : unitario, unitValue: unitario };
}

module.exports = { opcoesDePreco, reconhecerCompra, validarCompra, resolverCompra, compraDaForma, tarifaSemContrato, referenciaDePreco, valorRegular };
