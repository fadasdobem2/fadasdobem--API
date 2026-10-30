'use strict';

/**
 * Consulta, TARIFA no servidor (Maturacao/38): porte de `domain/consultation-pricing.ts` (`resolveConsultationTariff`, `priceNewConsultation`,
 * `repriceChangedComplement`) e de `domain/pricing.ts` (`paymentPurchasedMinutes`). A tabela de preços é a REAL (`gf_precos_versoes` + VAL-001,
 * `ctx.history`), o histórico e o saldo da cliente são os REAIS (`ctx.consultations`, `ctx.profiles`). Puro: o instante entra por parâmetro.
 * Ouro do código real do front (`scripts/apoio-gf-consulta/regras/gerar-edicao.js`).
 */

const b = require('./financeiro-base');
const cob = require('./financeiro-cobranca');
const { tarifaDeCredito } = require('./financeiro-saldo');
const { complementoDisponivel } = require('./consulta-vinculos');

const unidade = (valor) => Math.round(valor * 100) / 100;
const semC = (id) => id.toUpperCase().replace(/^C-/, '');
const ordemDePagamento = (a, c) => Date.parse(b.pagoEm(a)) - Date.parse(b.pagoEm(c)) || Date.parse(a.informedAt) - Date.parse(c.informedAt);

/** `paymentPurchasedMinutes`. */
function minutosDoPagamento(p, valorLegado = 2.96) {
  if (p.cashUnitValue) return Math.max(0, Math.floor(p.amount / p.cashUnitValue + 0.000001));
  if (p.purchase) return p.purchase.minutes;
  return b.minutosComprados(p.amount, valorLegado);
}

/** `resolveConsultationTariff`. `req`: `{ clientId, at, consultationId, expectedMinutes, coverage, existing, payments, repriceContract }`. `ctx`: `{ consultations, profiles, history }`. */
function resolverTarifa(req, ctx) {
  const { clientId, at, existing, coverage } = req;
  if (existing && existing.specialPrice) return { table: 'custom', source: 'price-table', unitValue: existing.specialPrice.unitValue, resolvedAt: existing.specialPrice.at };
  if (existing && existing.clientId === clientId && existing.launchTimeDecision && existing.launchTimeDecision.kind === 'discount' && existing.billing && existing.billing.tariff) return existing.billing.tariff;
  const pricing = b.precoVigente(ctx.history, at);
  const base = { resolvedAt: at };
  const origem = coverage && coverage.sourceConsultationId ? ctx.consultations.find((c) => c.clientId === clientId && semC(c.id) === semC(coverage.sourceConsultationId)) : undefined;
  const pagamentos = req.payments || [];
  if (coverage && coverage.kind === 'Crédito' && !existing) {
    const credito = tarifaDeCredito(clientId, at, coverage.minutes || req.expectedMinutes, ctx.consultations, pagamentos, ctx.profiles[clientId], req.consultationId, false);
    if (credito.availableLots.length) return { ...base, table: 'custom', source: 'credit', unitValue: credito.unitValue, paymentIds: credito.availableLots.flatMap((l) => (l.paymentId ? [l.paymentId] : [])), sourceConsultationId: credito.sourceConsultationId, creditLots: credito.availableLots };
  }
  const tarifaGravada = existing && existing.billing && existing.billing.tariff;
  if (tarifaGravada && tarifaGravada.creditLots && tarifaGravada.creditLots.length && !req.repriceContract && (existing.coverage && existing.coverage.kind) === (coverage && coverage.kind)) return tarifaGravada;
  if (coverage && coverage.kind === 'Complemento' && coverage.complementMode === 'prepaid' && origem && !existing) {
    const disponivel = complementoDisponivel(origem, ctx.consultations, pagamentos, req.consultationId);
    const lotes = disponivel && disponivel.creditLots && b.fatiarLotes(disponivel.creditLots, 0, coverage.minutes);
    if (lotes && lotes.length) {
      const minutos = lotes.reduce((s, l) => s + l.minutes, 0);
      return { ...base, table: 'custom', source: 'complement', unitValue: lotes.reduce((s, l) => s + l.minutes * l.unitValue, 0) / minutos, sourceConsultationId: origem.id, creditLots: lotes };
    }
  }
  if ((coverage && coverage.kind === 'Complemento') || (coverage && coverage.kind === 'Bônus' && origem) || (coverage && coverage.kind === 'Crédito' && coverage.unitValue)) {
    const unitValue = coverage.unitValue || (origem ? cob.valorDoMinutoDaConsulta(origem, pagamentos) : existing && existing.minuteValue) || 2.96;
    return { ...base, table: (origem && origem.billing && origem.billing.tariff && origem.billing.tariff.table) || 'custom', source: coverage.kind === 'Complemento' ? 'complement' : coverage.kind === 'Bônus' ? 'bonus' : 'credit', unitValue, sourceConsultationId: origem ? origem.id : coverage.sourceConsultationId };
  }
  const consultaId = req.consultationId || (existing && existing.id);
  if (tarifaGravada && tarifaGravada.source === 'price-table' && !req.repriceContract && !coverage) return tarifaGravada;
  const compras = !coverage && consultaId ? pagamentos.filter((p) => p.clientId === clientId && p.status !== 'Cancelado' && p.linkedConsultationId === consultaId).sort(ordemDePagamento) : [];
  const valorLegado = (existing && existing.minuteValue) || 2.96;
  if (compras.some((p) => p.cashUnitValue)) {
    const minutos = compras.reduce((s, p) => s + (p.cashUnitValue ? p.amount / p.cashUnitValue : (p.purchase && p.purchase.minutes) || p.amount / valorLegado), 0);
    const lotes = compras.map((p) => {
      const comprados = p.cashUnitValue ? p.amount / p.cashUnitValue : (p.purchase && p.purchase.minutes) || p.amount / valorLegado;
      return { paymentId: p.id, sourceConsultationId: consultaId, kind: p.purchase && !p.cashUnitValue ? 'purchase' : 'cash', minutesKnown: Boolean(p.cashUnitValue || p.purchase), cents: Math.round(p.amount * 100), minutes: comprados, unitValue: p.cashUnitValue || p.amount / comprados,
        ...(p.purchase && !p.cashUnitValue ? { purchaseMinutes: p.purchase.minutes, purchaseAmount: p.amount } : {}), usedMinutes: 0, usedConsultationMinutes: 0 };
    });
    return { ...base, table: 'custom', source: 'price-table', unitValue: compras.reduce((s, p) => s + p.amount, 0) / minutos, paymentIds: compras.map((p) => p.id), ...(!existing || (tarifaGravada && tarifaGravada.creditLots && tarifaGravada.creditLots.length) ? { creditLots: lotes } : {}) };
  }
  const financiado = (p) => Boolean(existing && existing.billing && existing.billing.funding.some((l) => l.paymentId === p.id && l.minutes > 0));
  if (compras.length && compras.every((p) => (p.purchase && p.purchase.minutes) || financiado(p) || b.minutosDoPacoteLegado(p.amount))) {
    const comprados = (p) => (p.purchase && p.purchase.minutes) || ((existing && existing.billing && existing.billing.funding.find((l) => l.paymentId === p.id)) || {}).minutes || b.minutosDoPacoteLegado(p.amount) || minutosDoPagamento(p, existing && existing.minuteValue);
    const minutos = compras.reduce((s, p) => s + comprados(p), 0); const valor = compras.reduce((s, p) => s + p.amount, 0);
    const lotes = compras.map((p) => { const n = (p.purchase && p.purchase.minutes) || b.minutosDoPacoteLegado(p.amount) || minutosDoPagamento(p, existing && existing.minuteValue); return { paymentId: p.id, sourceConsultationId: consultaId, kind: 'purchase', minutesKnown: true, cents: Math.round(p.amount * 100), minutes: n, unitValue: p.amount / n, purchaseMinutes: n, purchaseAmount: p.amount, usedMinutes: 0 }; });
    const tabela = compras.every((p) => (p.purchase && p.purchase.table) === (compras[0].purchase && compras[0].purchase.table)) ? (compras[0].purchase && compras[0].purchase.table) || 'custom' : 'custom';
    return { ...base, table: tabela, source: 'purchase', unitValue: valor / minutos, packageMinutes: minutos, packageAmount: valor, paymentIds: compras.map((p) => p.id), priceVersionId: compras[0].purchase && compras[0].purchase.priceVersionId, ...(!existing || (tarifaGravada && tarifaGravada.creditLots && tarifaGravada.creditLots.length) ? { creditLots: lotes } : {}) };
  }
  if (tarifaGravada) return tarifaGravada;
  if (existing && existing.clientId === clientId) return { ...base, table: 'custom', source: coverage && coverage.kind === 'Crédito' ? 'credit' : 'legacy', unitValue: cob.valorDoMinutoDaConsulta(existing, pagamentos) };
  if (coverage && coverage.kind === 'Crédito') {
    const credito = tarifaDeCredito(clientId, at, coverage.minutes, ctx.consultations, pagamentos, ctx.profiles[clientId], existing && existing.id);
    return { ...base, table: 'custom', source: 'credit', unitValue: credito.unitValue, paymentIds: credito.paymentIds, sourceConsultationId: credito.sourceConsultationId };
  }
  const perfil = ctx.profiles[clientId];
  const { first, firstAt, knownOld } = b.elegibilidadePrimeira(clientId, at, ctx.consultations, perfil, pricing.firstConsultationWindowHours, existing && existing.id);
  const tabela = first ? 'first' : 'regular';
  const opcoes = first ? pricing.firstConsultationPrices : pricing.regularPrices;
  const pacote = opcoes.find((p) => p.minutes === req.expectedMinutes);
  if (!first && !pacote) return { ...base, table: tabela, source: 'price-table', unitValue: b.valorDoMinuto(pricing), priceVersionId: pricing.id, firstConsultationAt: firstAt };
  const opcao = pacote || opcoes.find((p) => p.minutes === pricing.minimumMinutes) || opcoes[0];
  return { ...base, table: tabela, source: 'price-table', unitValue: opcao.price / opcao.minutes, packageMinutes: opcao.minutes, packageAmount: opcao.price, priceVersionId: pricing.id, firstConsultationAt: firstAt || (!knownOld ? at : undefined) };
}

/** `priceNewConsultation`. */
function precificarNova(item, ctx, pagamentos) {
  if (item.billing && item.billing.tariff) return item;
  const tarifa = item.specialPrice ? { table: 'custom', source: 'price-table', unitValue: item.specialPrice.unitValue, resolvedAt: item.specialPrice.at }
    : resolverTarifa({ clientId: item.clientId, at: item.startedAt, consultationId: item.id, expectedMinutes: item.benefitConsumptionOrder === 'benefits-first' ? item.paidMinutesBeforeBenefits : item.expectedMinutes, coverage: item.coverage, payments: pagamentos }, ctx);
  return { ...item, minuteValue: tarifa.unitValue, billing: { ...item.billing, tariff: tarifa, minimumMinutes: (item.billing && item.billing.minimumMinutes) ?? b.precoVigente(ctx.history, item.startedAt).minimumMinutes, minimumWaived: (item.billing && item.billing.minimumWaived) || false, funding: (item.billing && item.billing.funding) || [] } };
}

/** `repriceChangedComplement`. */
function reprecificarComplemento(item, anterior, ctx, pagamentos) {
  const eraComplemento = anterior.coverage && anterior.coverage.kind === 'Complemento'; const eComplemento = item.coverage && item.coverage.kind === 'Complemento';
  if (!eraComplemento && !eComplemento) return item;
  const a = anterior.coverage || {}; const c = item.coverage || {};
  const mudou = a.kind !== c.kind || a.sourceConsultationId !== c.sourceConsultationId || a.minutes !== c.minutes || a.complementMode !== c.complementMode;
  if (!mudou) return item;
  const nova = { ...item, billing: item.billing ? { ...item.billing, tariff: undefined, unitValueOverride: undefined } : undefined };
  return precificarNova(nova, { ...ctx, consultations: ctx.consultations.filter((r) => r.id !== item.id) }, pagamentos);
}

module.exports = { resolverTarifa, precificarNova, reprecificarComplemento, minutosDoPagamento, unidade };
