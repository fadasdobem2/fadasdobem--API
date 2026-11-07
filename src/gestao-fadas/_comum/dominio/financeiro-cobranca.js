'use strict';

/**
 * Domínio financeiro da cliente, parte 2: a cobrança da consulta. Porte de `domain/consultation-billing.ts` (`performedMinutes`,
 * `consultationFunding`, `consultationUnitValue`, `consultationSettlement`, `complementUsage`). Ouro do código real do front.
 */

const b = require('./financeiro-base');
const fd = require('./financeiro-financiamento-dividido');
const { minutosDeArredondamento } = require('./credito-arredondamento');

const dinheiro = (v) => Math.round(v * 100) / 100;
const confirmado = (p) => p.status !== 'Cancelado' && (p.confirmation ? p.confirmation === 'Confirmado' : p.status === 'Informado' || p.status === 'Corrigido');
const principal = (p) => Math.max(0, dinheiro(p.amount + (p.movements || []).reduce((s, m) => s + m.creditEffect, 0)));

const minutosRealizados = (item) => (item.status === 'Não houve' ? 0 : Math.max(0, Math.ceil(item.durationSeconds / 60)));
const minutosRelatados = (item) => (item.status === 'Não houve' ? 0 : Math.max(0, Math.ceil((item.performedDurationSeconds ?? (item.status === 'Finalizada pelo tarólogo' && item.tarologistFinishReport && Number.isFinite(item.tarologistFinishReport.minutes) ? item.tarologistFinishReport.minutes * 60 : item.durationSeconds)) / 60)));

function minutosDeCredito(item) {
  if (!(item.coverage && item.coverage.balanceOnly)) return (item.coverage && item.coverage.minutes) || 0;
  const lotes = item.billing && item.billing.tariff && item.billing.tariff.creditLots;
  if (lotes && lotes.length) return lotes.reduce((s, l) => s + l.minutes, 0) + minutosDeArredondamento(lotes, item.billing.tariff.creditRounding);
  const unit = item.coverage.unitValue || item.minuteValue || 2.96;
  return unit > 0 ? Math.max(0, Math.floor(((item.coverage.balanceAtLaunch || 0) + 0.000001) / unit)) : 0;
}

function financiamento(item, pagamentos) {
  if (!pagamentos) return (item.billing && item.billing.funding) || [];
  return pagamentos.filter((p) => !p.unidentified && p.clientId === item.clientId && confirmado(p)).flatMap((p) => {
    const salvo = item.billing && (item.billing.funding || []).find((l) => l.paymentId === p.id);
    if (p.linkedConsultationId === item.id) return [{ paymentId: p.id, amount: p.amount, minutes: p.cashUnitValue ? Math.floor(p.amount / p.cashUnitValue + 0.000001) : (p.purchase && p.purchase.minutes) || (salvo && salvo.minutes) || b.minutosComprados(p.amount, item.minuteValue || 2.96) }];
    // v706: recibo dividido, a fatia gravada nesta consulta.
    const compartilhado = fd.financiamentoCompartilhado(item, p);
    if (!compartilhado || p.amount <= 0) return [];
    if (compartilhado.amount === 0) return [{ ...compartilhado, amount: 0, minutes: 0 }];
    const amount = Math.min(compartilhado.amount, p.amount);
    return [{ ...compartilhado, amount, minutes: compartilhado.minutes * amount / compartilhado.amount }];
  });
}

function minutosParaPrecificarCredito(item) {
  const beneficiados = b.usoDosBeneficios(item).reduce((s, x) => s + x.usedMinutes, 0);
  return item.durationSeconds > 0 ? Math.max(0, minutosRealizados(item) - beneficiados) : item.paidMinutesBeforeBenefits ?? item.expectedMinutes ?? (item.coverage && item.coverage.minutes) ?? 0;
}

function valorDoMinutoDaConsulta(item, pagamentos) {
  if (item.specialPrice) return item.specialPrice.unitValue;
  if (b.valorRegistradoDoMinuto(item) === 0) return 0;
  const tarifa = item.billing && item.billing.tariff;
  if (item.paymentProfile === 'Pós-paga' && tarifa && !tarifa.creditRounding) return item.billing.unitValueOverride ?? tarifa.unitValue;
  if (item.launchTimeDecision && item.launchTimeDecision.kind === 'discount' && tarifa) return tarifa.unitValue;
  const lotes = tarifa && tarifa.creditLots;
  if (lotes && lotes.length) {
    const minutos = minutosParaPrecificarCredito(item);
    if (minutos > 0) return b.alocarLotes(lotes, minutos, tarifa.unitValue, tarifa.creditRounding).rawAmount / minutos;
    return tarifa.unitValue;
  }
  if (item.coverage && item.coverage.kind === 'Complemento') return item.coverage.unitValue || item.minuteValue || 2.96;
  const contratados = pagamentos && pagamentos.filter((p) => p.clientId === item.clientId && p.linkedConsultationId === item.id && p.status !== 'Cancelado');
  const temCompra = contratados && contratados.some((p) => p.purchase);
  if (!item.coverage && contratados && contratados.some((p) => p.cashUnitValue)) {
    const minutos = contratados.reduce((s, p) => s + (p.cashUnitValue ? p.amount / p.cashUnitValue : (p.purchase && p.purchase.minutes) || p.amount / ((tarifa && tarifa.unitValue) || item.minuteValue || 2.96)), 0);
    return minutos > 0 ? contratados.reduce((s, p) => s + p.amount, 0) / minutos : item.minuteValue || 2.96;
  }
  if (item.coverage && item.coverage.unitValue) return item.coverage.unitValue;
  if (tarifa && tarifa.source === 'price-table') return tarifa.unitValue;
  if (item.billing && item.billing.unitValueOverride && (!temCompra || item.coverage)) return item.billing.unitValueOverride;
  const fonte = contratados ? contratados.map((p) => ({ amount: p.amount, minutes: (p.purchase && p.purchase.minutes) || ((item.billing && item.billing.funding.find((l) => l.paymentId === p.id)) || {}).minutes || b.minutosComprados(p.amount, (tarifa && tarifa.unitValue) || item.minuteValue || 2.96) })) : financiamento(item, pagamentos);
  if (item.coverage && tarifa) return tarifa.unitValue;
  const minutos = fonte.reduce((s, l) => s + l.minutes, 0);
  return minutos > 0 ? fonte.reduce((s, l) => s + l.amount, 0) / minutos : (tarifa && tarifa.unitValue) || item.minuteValue || 2.96;
}

function usoDoComplemento(item) {
  if (item.status === 'Em curso') {
    if (item.benefitConsumptionOrder !== 'benefits-first') return item.coverage.minutes;
    const alocado = (item.minuteBenefits || []).reduce((s, x) => s + x.minutes, 0);
    return Math.min(item.coverage.minutes, Math.max(0, (item.expectedMinutes ?? item.coverage.minutes + alocado) - alocado));
  }
  const dosBeneficios = item.benefitConsumptionOrder === 'benefits-first' ? b.usoDosBeneficios(item).reduce((s, x) => s + x.usedMinutes, 0) : 0;
  return Math.min(item.coverage.minutes, Math.max(0, minutosRealizados(item) - dosBeneficios));
}

/** `consultationSettlement` (consultation-billing.ts): minutos cobráveis, débito, crédito em dinheiro e minutos de complemento. */
function acerto(item, pagamentos) {
  const real = minutosRealizados(item);
  const minimo = (item.billing && item.billing.minimumMinutes) ?? 15;
  const unitValue = valorDoMinutoDaConsulta(item, pagamentos);
  const funding = financiamento(item, pagamentos);
  const comprados = item.coverage && item.coverage.kind === 'Crédito' ? minutosDeCredito(item) : funding.reduce((s, l) => s + l.minutes, 0);
  const lotesDaTarifa = item.billing && item.billing.tariff && item.billing.tariff.creditLots;
  const financiado = item.coverage && item.coverage.kind === 'Crédito'
    ? (item.coverage.balanceOnly ? item.coverage.balanceAtLaunch || 0 : lotesDaTarifa && lotesDaTarifa.length ? b.alocarLotes(lotesDaTarifa, item.coverage.minutes, item.billing.tariff.unitValue, item.billing.tariff.creditRounding).amount : item.coverage.minutes * unitValue)
    : pagamentos ? funding.reduce((s, l) => { const p = pagamentos.find((x) => x.id === l.paymentId); return s + (p ? fd.valorDaFatia(l, p) : 0); }, 0)
      : funding.reduce((s, l) => s + l.amount, 0);
  const beneficio = item.coverage;
  const livre = Boolean(beneficio) && (beneficio.kind === 'Cortesia' || beneficio.kind === 'Bônus');
  const complemento = Boolean(beneficio) && beneficio.kind === 'Complemento';
  const alocadosBeneficios = b.usoDosBeneficios(item).reduce((s, x) => s + x.usedMinutes, 0);
  const pagosReais = Math.max(0, real - alocadosBeneficios);
  const beneficiosPrimeiro = item.benefitConsumptionOrder === 'benefits-first';
  const minimoPago = beneficiosPrimeiro ? (pagosReais > 0 ? Math.min(item.paidMinutesBeforeBenefits || 0, Math.max(0, minimo - alocadosBeneficios)) : 0) : Math.min(minimo, item.paidMinutesBeforeBenefits || 0);
  const cobravelRegular = item.minuteBenefits && item.minuteBenefits.length
    ? (livre ? Math.max(0, pagosReais - beneficio.minutes) : complemento ? (beneficio.complementMode === 'credit' ? pagosReais : Math.max(0, pagosReais - beneficio.minutes)) : Math.max(pagosReais, !(item.billing && item.billing.minimumWaived) ? minimoPago : 0))
    : livre ? Math.max(0, real - beneficio.minutes)
      : complemento ? (beneficio.complementMode === 'credit' ? real : Math.max(0, real - beneficio.minutes))
        : Math.max(real, item.billing && item.billing.minimumWaived ? 0 : minimo);
  const mantemCreditoNaoUsado = item.status === 'Desistiu' && (!beneficio || beneficio.kind === 'Crédito') && Boolean(item.billing && item.billing.keepUnusedCashCredit);
  const cobravel = item.status === 'Não houve' ? 0 : mantemCreditoNaoUsado ? pagosReais : cobravelRegular;
  const lotesPrePagos = !item.specialPrice && complemento && beneficio.complementMode === 'prepaid' && lotesDaTarifa && lotesDaTarifa.length;
  const alocCredito = !lotesPrePagos && !item.specialPrice && lotesDaTarifa && lotesDaTarifa.length ? b.alocarLotes(lotesDaTarifa, cobravel, item.billing.tariff.unitValue, item.billing.tariff.creditRounding) : undefined;
  const preservaCobranca = b.contaMinutos(item.status) || b.retemCoberturaDeCancelamento(item);
  const debitoBruto = preservaCobranca ? (alocCredito ? alocCredito.amount : dinheiro(cobravel * (lotesPrePagos ? item.billing.tariff.unitValue : unitValue))) : 0;
  const dispensado = Math.min(debitoBruto, dinheiro(((item.billing && item.billing.chargeAdjustments) || []).reduce((s, a) => s + Math.max(0, Number.isFinite(a.amount) ? a.amount : 0), 0)));
  const debito = dinheiro(Math.max(0, debitoBruto - dispensado));
  const pagaCobertura = !beneficio || beneficio.kind === 'Crédito';
  const preservaConcluida = item.status === 'Concluída' || (item.cancellationReview && item.cancellationReview.readerStatus === 'Concluída');
  const elegivel = pagaCobertura && preservaConcluida && unitValue > 0
    ? Math.max(0, Math.min(beneficiosPrimeiro ? cobravel : minimo, comprados, financiado / unitValue, item.minuteBenefits && item.minuteBenefits.length ? item.paidMinutesBeforeBenefits || 0 : Infinity) - pagosReais) : 0;
  const dispensaMinimo = Boolean(item.billing && item.billing.minimumWaived);
  return {
    actual: real, reported: minutosRelatados(item), minimum: minimo, unitValue, purchased: comprados, funded: dinheiro(financiado), chargeable: cobravel, grossDebit: debitoBruto, waivedAmount: dispensado, debit: debito,
    creditAllocations: alocCredito && alocCredito.allocations,
    cashCredit: preservaCobranca || item.status === 'Não houve' ? dinheiro(Math.max(0, financiado - debito)) : 0,
    complementMinutes: dispensaMinimo ? 0 : Math.floor(elegivel + 0.000001),
    creditCompletionMinutes: dispensaMinimo ? Math.floor(elegivel + 0.000001) : 0,
    unusedBenefit: item.minuteBenefits && item.minuteBenefits.length ? item.minuteBenefits.reduce((s, x) => s + x.minutes, 0) - alocadosBeneficios : livre ? Math.max(0, beneficio.minutes - real) : 0,
    canWaive: pagaCobertura && pagosReais > 0 && pagosReais < minimo && item.status !== 'Devolvida',
  };
}

module.exports = { dinheiro, confirmado, principal, minutosRealizados, minutosRelatados, minutosDeCredito, financiamento, valorDoMinutoDaConsulta, usoDoComplemento, acerto };
