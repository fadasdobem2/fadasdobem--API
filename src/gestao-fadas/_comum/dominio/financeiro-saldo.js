'use strict';

/**
 * Domínio financeiro da cliente, parte 3: saldo, lotes de crédito e a conferência de encerramento com cobertura. Porte de
 * `finance/cash-ledger.ts` (`clientCashAccount`, helpers de recebimento), `domain/credit-tariff.ts` (`clientCreditTariff`, lotes FIFO),
 * `finance/client-payment-state.ts` (`clientFundingCoverage`) e `tarologas/tarologist-finish-assessment.ts` (`assessTarologistFinish`
 * COM contexto financeiro). Ouro do código real do front.
 */

const b = require('./financeiro-base');
const c = require('./financeiro-cobranca');

const emCentavos = (v) => Math.round(v * 100);
const arredondar = (v) => emCentavos(v) / 100;
const bruto = (p) => (p.grossAmount ?? p.amount);
const recebimentoConfirmado = (p) => p.status !== 'Cancelado' && (p.confirmation ? p.confirmation === 'Confirmado' : p.status === 'Informado' || p.status === 'Corrigido');
const efeitoDaTransferencia = (m, clientId) => (m.kind === 'balance-transfer' && m.balanceTransfer ? (m.balanceTransfer.sourceClientId === clientId ? -m.amount : m.balanceTransfer.targetClientId === clientId ? m.amount : 0) : 0);
const efeitoNaConta = (p, m) => (m.kind === 'balance-transfer' ? efeitoDaTransferencia(m, p.clientId) : recebimentoConfirmado(p) ? m.creditEffect : 0);
const debitoDaConsulta = (item, pagamentos) => c.acerto(item, pagamentos).debit;

/** `clientCashAccount` (cash-ledger.ts:83). `abertura` em REAIS (saldo de partida, negativo = dívida). */
function contaDaCliente(clientId, pagamentos, consultas, abertura = 0) {
  const proprios = pagamentos.filter((p) => p.clientId === clientId);
  const creditos = proprios.filter(recebimentoConfirmado).reduce((s, p) => s + emCentavos(p.amount), 0);
  const consumo = consultas.filter((i) => i.clientId === clientId).reduce((s, i) => s + emCentavos(debitoDaConsulta(i, pagamentos)), 0);
  const movimentos = pagamentos.flatMap((p) => (p.movements || []).filter((m) => (m.kind === 'balance-transfer' ? efeitoDaTransferencia(m, clientId) !== 0 : p.clientId === clientId))
    .map((m) => ({ payment: m.kind === 'balance-transfer' ? { ...p, clientId } : p, movement: m })));
  const ajustes = movimentos.reduce((s, { payment, movement }) => s + emCentavos(efeitoNaConta(payment, movement)), 0);
  const balance = (emCentavos(abertura) + creditos - consumo + ajustes) / 100;
  return { balance, received: creditos / 100, consumed: consumo / 100, adjustments: ajustes / 100 };
}

/** `clientCreditTariff` (credit-tariff.ts): lotes confirmados em FIFO; minutos e dinheiro são duas visões da mesma compra. */
function tarifaDeCredito(clientId, em, minutosPedidos, consultas, pagamentos, perfil, exceptoId, reservarEmCurso = true) {
  const lotes = [];
  let divida = Math.max(0, -Math.round(((perfil && perfil.credit) || 0) * 100));
  const abertura = perfil && perfil.openingCredit;
  const aberturaValida = abertura && Number.isFinite(abertura.minutes) && abertura.minutes > 0 && Math.round(abertura.amount * 100) === Math.round(((perfil && perfil.credit) || 0) * 100);
  if (((perfil && perfil.credit) || 0) > 0) {
    const taxaOriginal = abertura && abertura.purchaseMinutes && abertura.purchaseAmount ? abertura.purchaseAmount / abertura.purchaseMinutes : undefined;
    const originalConfere = aberturaValida && taxaOriginal && Math.abs(Math.round(abertura.minutes * taxaOriginal * 100) - Math.round(abertura.amount * 100)) <= 1;
    const cents = Math.round(perfil.credit * 100);
    const unitValue = aberturaValida ? (originalConfere ? taxaOriginal : abertura.amount / abertura.minutes) : 2.96;
    lotes.push({ kind: 'opening', minutesKnown: Boolean(aberturaValida), cents, minutes: aberturaValida ? abertura.minutes : cents / 100 / unitValue, unitValue,
      ...(aberturaValida && originalConfere ? { purchaseMinutes: abertura.purchaseMinutes, purchaseAmount: abertura.purchaseAmount } : {}),
      usedMinutes: aberturaValida && originalConfere ? Math.max(0, abertura.purchaseMinutes - abertura.minutes) : 0 });
  }
  const eventos = []; const limite = Date.parse(em);
  const proprios = pagamentos.filter((p) => p.clientId === clientId && p.status !== 'Cancelado' && (p.confirmation ? p.confirmation === 'Confirmado' : ['Informado', 'Corrigido'].includes(p.status)));
  for (const p of proprios) {
    const origem = consultas.find((x) => x.clientId === clientId && x.id === p.linkedConsultationId);
    const precoPrimeira = b.PRECOS_PADRAO.firstConsultationPrices.some((o) => Math.round(o.price * 100) === Math.round(p.amount * 100));
    const elegivel = p.method === 'PIX' && b.elegibilidadePrimeira(clientId, b.pagoEm(p), consultas, perfil).first;
    const minutosLegado = precoPrimeira && !elegivel ? 0 : b.minutosDoPacoteLegado(p.amount);
    const minutosPacote = (p.purchase && p.purchase.minutes) || (!p.cashUnitValue ? minutosLegado : undefined);
    const unitValue = p.cashUnitValue || (p.purchase && p.purchase.minutes > 0 ? p.purchase.amount / p.purchase.minutes : origem ? c.valorDoMinutoDaConsulta(origem, proprios) : minutosLegado ? p.amount / minutosLegado : 2.96);
    const lote = { kind: minutosPacote ? 'purchase' : 'cash', minutesKnown: Boolean(p.cashUnitValue || p.purchase || origem || minutosLegado), paymentId: p.id, sourceConsultationId: origem && origem.id, cents: 0, minutes: 0, unitValue,
      ...(minutosPacote ? { purchaseMinutes: minutosPacote, purchaseAmount: (p.purchase && p.purchase.amount) || p.amount } : {}), usedMinutes: 0, usedConsultationMinutes: 0 };
    eventos.push({ at: Date.parse(b.pagoEm(p)), amount: Math.round(p.amount * 100), lot: lote, rank: 0, minutes: p.amount / unitValue });
    for (const m of (p.movements || []).filter((x) => x.kind !== 'balance-transfer')) {
      eventos.push({ at: Date.parse(m.occurredAt), amount: Math.round(m.creditEffect * 100), lot: lote, preferred: [p.id], rank: 1, minutes: m.creditSnapshot ? Math.abs(m.creditSnapshot.minutesEffect) : undefined, authoritativeMinutes: Boolean(m.creditSnapshot) });
    }
  }
  for (const p of pagamentos) {
    for (const m of p.movements || []) {
      if (m.kind !== 'balance-transfer' || !m.balanceTransfer) continue;
      const t = m.balanceTransfer; const lot = t.lot;
      if (t.sourceClientId === clientId) eventos.push({ at: Date.parse(m.occurredAt), amount: -Math.round(m.amount * 100), rank: 1, allocations: [{ ...lot, usedCents: lot.cents, usedMinutes: lot.minutes }], minutes: lot.minutes, authoritativeMinutes: true });
      if (t.targetClientId === clientId) eventos.push({ at: Date.parse(m.occurredAt), amount: Math.round(m.amount * 100), lot: { ...lot, transferId: m.id }, rank: 1, minutes: lot.minutes, authoritativeMinutes: true });
    }
  }
  for (const k of consultas) {
    if (k.clientId !== clientId || k.id === exceptoId) continue;
    const ac = c.acerto(k, proprios);
    const cov = k.coverage;
    let reservaMinutos = cov && (cov.kind === 'Crédito' || (cov.kind === 'Complemento' && cov.complementMode === 'credit'))
      ? (cov.kind === 'Complemento' && k.benefitConsumptionOrder === 'benefits-first' ? c.usoDoComplemento(k)
        : cov.balanceOnly ? k.paidMinutesBeforeBenefits ?? Math.max(0, (k.expectedMinutes ?? (k.billing && k.billing.tariff && k.billing.tariff.creditLots && k.billing.tariff.creditLots.reduce((s, l) => s + l.minutes, 0)) ?? (cov.balanceAtLaunch || 0) / c.valorDoMinutoDaConsulta(k, proprios)) - ((k.minuteBenefits && k.minuteBenefits.reduce((s, x) => s + x.minutes, 0)) || 0))
          : cov.minutes) : 0;
    if (k.status === 'Em curso' && cov && cov.kind === 'Crédito') reservaMinutos = Math.max(reservaMinutos, ac.chargeable);
    const lotesDaTarifa = k.billing && k.billing.tariff && k.billing.tariff.creditLots;
    const alocacao = !k.specialPrice && !(cov && cov.kind === 'Complemento' && cov.complementMode === 'prepaid') && lotesDaTarifa && lotesDaTarifa.length
      ? b.alocarLotes(lotesDaTarifa, k.status === 'Em curso' ? reservaMinutos : ac.chargeable, k.billing.tariff.unitValue) : undefined;
    const reservado = reservaMinutos ? Math.round(((alocacao ? alocacao.amount : reservaMinutos * c.valorDoMinutoDaConsulta(k, proprios))) * 100)
      : !cov ? proprios.filter((p) => p.linkedConsultationId === k.id && Date.parse(b.pagoEm(p)) <= limite).reduce((s, p) => s + Math.round(p.amount * 100), 0) : 0;
    const descontoCents = k.launchTimeDecision && k.launchTimeDecision.kind === 'discount' ? ((k.billing && k.billing.chargeAdjustments) || []).reduce((s, r) => s + Math.max(0, Math.round(r.amount * 100)), 0) : 0;
    const liquidoReservado = reservaMinutos ? Math.max(0, reservado - descontoCents) : reservado;
    const debito = k.status === 'Em curso' ? (reservarEmCurso ? liquidoReservado : 0) : Math.round(ac.debit * 100);
    if (debito) {
      eventos.push({ consultationConsumption: k.status !== 'Em curso', at: Date.parse(k.status === 'Em curso' ? k.startedAt : k.endedAt || k.startedAt), amount: -debito,
        preferred: cov && cov.kind === 'Crédito' && k.billing && k.billing.tariff && k.billing.tariff.paymentIds && k.billing.tariff.paymentIds.length ? k.billing.tariff.paymentIds : proprios.filter((p) => p.linkedConsultationId === k.id).map((p) => p.id),
        rank: 2, allocations: alocacao && alocacao.allocations, minutes: k.status === 'Em curso' ? reservaMinutos || undefined : ac.chargeable });
    }
  }
  const consumir = (ordenados, preciso, minutosExatos, autoritativo = false, consumoDeConsulta = false) => {
    if (preciso <= 0) return 0;
    let minutosRestantes = minutosExatos;
    for (const lote of ordenados) {
      if (lote.cents <= 0) continue;
      const usado = Math.min(preciso, lote.cents);
      let usadosMin = usado / 100 / lote.unitValue;
      if (usado === lote.cents) usadosMin = lote.minutes;
      else if (minutosRestantes !== undefined && (autoritativo || Math.abs(Math.round(Math.min(minutosRestantes, lote.minutes) * lote.unitValue * 100) - usado) <= 0)) usadosMin = Math.min(minutosRestantes, lote.minutes);
      usadosMin = Math.min(lote.minutes, usadosMin);
      lote.cents -= usado; lote.minutes = Math.max(0, lote.minutes - usadosMin); lote.usedMinutes = (lote.usedMinutes || 0) + usadosMin;
      if (consumoDeConsulta && lote.usedConsultationMinutes !== undefined) lote.usedConsultationMinutes += usadosMin;
      if (minutosRestantes !== undefined) minutosRestantes = Math.max(0, minutosRestantes - usadosMin);
      preciso -= usado; if (!preciso) break;
    }
    return preciso;
  };
  for (const e of eventos.filter((x) => x.at <= limite).sort((x, y) => x.at - y.at || x.rank - y.rank)) {
    if (e.amount >= 0) {
      const dividaPaga = Math.min(divida, e.amount); divida -= dividaPaga;
      if (e.amount > dividaPaga && e.lot) {
        const total = e.minutes ?? e.amount / 100 / e.lot.unitValue;
        lotes.push({ ...e.lot, cents: e.amount - dividaPaga, minutes: Math.max(0, total - dividaPaga / 100 / e.lot.unitValue) });
      }
    } else {
      let preciso = -e.amount;
      if (e.allocations && e.allocations.length) {
        for (const a of e.allocations) {
          if (preciso <= 0) break;
          const iguais = lotes.filter((l) => l.paymentId === a.paymentId && l.kind === a.kind && l.transferId === a.transferId);
          const centavosAloc = Math.min(preciso, a.usedCents);
          const minutosAloc = a.usedCents > 0 ? a.usedMinutes * centavosAloc / a.usedCents : 0;
          const faltou = consumir(iguais, centavosAloc, minutosAloc, true, e.consultationConsumption);
          preciso -= centavosAloc - faltou;
        }
      }
      if (preciso) {
        const ordenados = [...lotes.filter((l) => l.paymentId && e.preferred && e.preferred.includes(l.paymentId)), ...lotes.filter((l) => !l.paymentId || !(e.preferred && e.preferred.includes(l.paymentId)))];
        preciso = consumir(ordenados, preciso, e.allocations && e.allocations.length ? undefined : e.minutes, e.authoritativeMinutes, e.consultationConsumption);
      }
      divida += preciso;
    }
  }
  const disponiveis = lotes.filter((l) => l.cents > 0);
  const minutosExatos = disponiveis.reduce((s, l) => s + l.minutes, 0);
  const minutosDisponiveis = Math.max(0, Math.floor(minutosExatos + 0.000001));
  const pedidos = minutosPedidos && minutosPedidos > 0 ? minutosPedidos : minutosDisponiveis || minutosExatos;
  const selecao = b.alocarLotes(disponiveis, Math.min(pedidos, minutosExatos));
  const usados = selecao.allocations;
  const minutosSelecionados = usados.reduce((s, l) => s + l.usedMinutes, 0);
  return {
    unitValue: minutosSelecionados > 0 ? selecao.rawAmount / minutosSelecionados : 2.96, availableMinutes: minutosDisponiveis, exactAvailableMinutes: minutosExatos,
    availableAmount: disponiveis.reduce((s, l) => s + l.cents, 0) / 100,
    knownMinutes: disponiveis.filter((l) => l.minutesKnown).reduce((s, l) => s + l.minutes, 0),
    unknownAmount: disponiveis.filter((l) => !l.minutesKnown).reduce((s, l) => s + l.cents, 0) / 100,
    hasUnpricedOpening: disponiveis.some((l) => l.kind === 'opening' && !l.minutesKnown),
    availableLots: disponiveis.map((l) => ({ ...l })),
    paymentIds: [...new Set(usados.flatMap((l) => (l.paymentId ? [l.paymentId] : [])))],
  };
}

/** `clientFundingCoverage` (client-payment-state.ts): o que a cliente pode consumir e o rótulo que a tela mostra. */
function coberturaDaCliente(clientId, pagamentos, consultas, perfil, em) {
  const saldo = contaDaCliente(clientId, pagamentos, consultas, (perfil && perfil.credit) ?? 0).balance;
  const posPaga = Boolean(perfil) && perfil.paymentProfile === 'Pós-pago';
  const beneficios = b.beneficiosDisponiveis(clientId, perfil, consultas, undefined, em).filter((i) => i.remaining > 0);
  const minutosDeBeneficio = beneficios.reduce((s, i) => s + i.remaining, 0);
  const recebimentos = pagamentos.filter((p) => p.clientId === clientId && p.status !== 'Cancelado' && Math.max(0, arredondar(p.amount + (p.movements || []).reduce((s, m) => s + (m.kind === 'balance-transfer' ? efeitoDaTransferencia(m, clientId) : m.creditEffect), 0))) > 0);
  const temConfirmado = recebimentos.some(recebimentoConfirmado); const aguardando = recebimentos.some((p) => !recebimentoConfirmado(p));
  const confirmadoDisponivel = Math.max(0, contaDaCliente(clientId, pagamentos, consultas).balance);
  return { balance: saldo, postpaid: posPaga, benefitMinutes: minutosDeBeneficio, hasConfirmedReceipt: temConfirmado, confirmedAvailableBalance: confirmadoDisponivel, awaitingConfirmation: aguardando,
    canConsult: posPaga || saldo > 0, canLaunch: posPaga || saldo > 0 || minutosDeBeneficio > 0,
    label: posPaga ? 'Pós-paga' : saldo > 0 ? (temConfirmado && confirmadoDisponivel > 0 ? 'Pagou' : 'Crédito disponível') : minutosDeBeneficio > 0 ? 'Bônus / cortesia' : aguardando ? 'A confirmar' : 'Falta pagar' };
}

/** Parte financeira de `assessTarologistFinish` (tarologist-finish-assessment.ts:10): o excesso sobre o máximo só vale com saldo confirmado. */
function coberturaDoExcesso(item, minutos, em, financeiro) {
  const candidata = { ...item, status: 'Concluída', durationSeconds: Math.round(minutos * 60) };
  const debito = c.acerto(candidata, financeiro && financeiro.payments).debit;
  const centavosDisponiveis = financeiro ? tarifaDeCredito(item.clientId, em, undefined, financeiro.consultations, financeiro.payments, financeiro.profile, item.id, true).availableLots.reduce((s, l) => s + l.cents, 0) : 0;
  const outraEmCurso = financeiro ? financeiro.consultations.some((k) => k.id !== item.id && k.clientId === item.clientId && k.status === 'Em curso' && !k.tarologistFinishReport) : false;
  const extraCovered = Boolean(financeiro) && !outraEmCurso && Math.round(debito * 100) <= centavosDisponiveis;
  return { debit: debito, availableCents: centavosDisponiveis, otherActive: outraEmCurso, extraCovered };
}

module.exports = { emCentavos, arredondar, recebimentoConfirmado, contaDaCliente, tarifaDeCredito, coberturaDaCliente, coberturaDoExcesso, efeitoDaTransferencia };
