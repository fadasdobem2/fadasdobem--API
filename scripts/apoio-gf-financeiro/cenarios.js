'use strict';

/**
 * Cenários do ouro financeiro (Maturacao/29 seção 10): consultas, pagamentos e perfis montados à mão e por sorteio com semente fixa
 * (mulberry32), SEM relógio nem aleatoriedade do ambiente. O gerador (`scripts/gerar-ouro-gf-financeiro.js`) roda o código REAL do front
 * em cada um e grava a resposta; o verificador compara o porte do servidor. Mudar este arquivo muda o ouro (gere de novo).
 */

function semente(n) {
  let a = n >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const CLIENTE = '900100';
const DIA = (n) => `2026-10-${String(10 + n).padStart(2, '0')}T13:00:00-03:00`;
const ISO = (n, min = 0) => new Date(Date.parse(DIA(n)) + min * 60000).toISOString();

function consulta(o) {
  const inicio = o.startedAt || ISO(o.dia || 0);
  const seg = o.durationSeconds ?? 0;
  const status = o.status || 'Concluída';
  return {
    id: o.id, clientId: o.clientId || CLIENTE, client: 'Cliente Teste', tarotId: 'osiris', tarot: 'Osíris', status, startedAt: inicio,
    endedAt: status === 'Em curso' ? undefined : new Date(Date.parse(inicio) + seg * 1000).toISOString(), durationSeconds: seg,
    paymentProfile: o.paymentProfile || 'Pré-paga', channel: 'WhatsApp', attendant: 'Khloe', observation: '', updatedAt: inicio, audit: [], commissionRate: 30,
    ...(o.coverage ? { coverage: { registeredBy: 'Khloe', registeredAt: inicio, ...o.coverage } } : {}),
    billing: { minimumMinutes: 15, minimumWaived: false, funding: [], ...(o.billing || {}) },
    ...(o.minuteBenefits ? { minuteBenefits: o.minuteBenefits } : {}), ...(o.paidMinutesBeforeBenefits !== undefined ? { paidMinutesBeforeBenefits: o.paidMinutesBeforeBenefits } : {}),
    ...(o.benefitConsumptionOrder ? { benefitConsumptionOrder: o.benefitConsumptionOrder } : {}), ...(o.minuteValue !== undefined ? { minuteValue: o.minuteValue } : {}),
    ...(o.tarologistFinishReport ? { tarologistFinishReport: o.tarologistFinishReport } : {}), ...(o.cancellationReview ? { cancellationReview: o.cancellationReview } : {}),
    ...(o.bonusGrant ? { bonusGrant: o.bonusGrant } : {}), ...(o.specialPrice ? { specialPrice: o.specialPrice } : {}), ...(o.launchTimeDecision ? { launchTimeDecision: o.launchTimeDecision } : {}),
    ...(o.expectedMinutes !== undefined ? { expectedMinutes: o.expectedMinutes } : {}),
  };
}
function pagamento(o) {
  const quando = o.paidAt || ISO(o.dia || 0, -30);
  return {
    id: o.id, clientId: o.clientId || CLIENTE, client: 'Cliente Teste', amount: o.amount, method: o.method || 'PIX', paidAt: quando, informedAt: quando, informedBy: 'Khloe',
    status: o.status || 'Informado', ...(o.confirmation ? { confirmation: o.confirmation } : {}), ...(o.linked ? { linkedConsultationId: o.linked } : {}),
    ...(o.purchase ? { purchase: o.purchase } : {}), ...(o.cashUnitValue ? { cashUnitValue: o.cashUnitValue } : {}), ...(o.movements ? { movements: o.movements } : {}),
    ...(o.grossAmount ? { grossAmount: o.grossAmount, actualFee: o.actualFee } : {}),
  };
}
const refund = (id, amount, creditEffect, em) => ({ id, kind: 'refund', amount, bankEffect: -amount, creditEffect, occurredAt: em, actor: 'Laya', note: 'Estorno de teste' });

function manuais() {
  const m = [];
  const perfilVazio = { clientId: CLIENTE, name: 'Cliente Teste', paymentProfile: 'Pré-pago', birthDate: '', whatsapp: '', credit: 0, creditUpdatedAt: '', movements: [], neverTarotIds: [] };
  // Cobertura do excesso: saldo confirmado cobre, não cobre, e outra consulta em curso.
  const emCurso = consulta({ id: 'K1', status: 'Em curso', durationSeconds: 0, coverage: { kind: 'Crédito', minutes: 30 }, expectedMinutes: 30, billing: { tariff: { table: 'regular', source: 'price-table', unitValue: 2.96, resolvedAt: ISO(0) } } });
  m.push({ tipo: 'excesso', item: emCurso, minutos: 45, em: ISO(0, 50), fin: { payments: [pagamento({ id: 'P1', amount: 88.8, linked: 'K1', purchase: { minutes: 30, amount: 88.8, table: 'regular', priceVersionId: 'VAL-001' } })], consultations: [emCurso], profile: perfilVazio } });
  m.push({ tipo: 'excesso', item: emCurso, minutos: 45, em: ISO(0, 50), fin: { payments: [pagamento({ id: 'P1', amount: 88.8, linked: 'K1', purchase: { minutes: 30, amount: 88.8, table: 'regular', priceVersionId: 'VAL-001' } }), pagamento({ id: 'P2', amount: 59.2, confirmation: 'Confirmado' })], consultations: [emCurso], profile: perfilVazio } });
  m.push({ tipo: 'excesso', item: emCurso, minutos: 45, em: ISO(0, 50), fin: { payments: [], consultations: [emCurso], profile: perfilVazio } });
  m.push({ tipo: 'excesso', item: emCurso, minutos: 30, em: ISO(0, 50), fin: { payments: [], consultations: [emCurso, consulta({ id: 'K2', status: 'Em curso', dia: 0 })], profile: perfilVazio } });
  m.push({ tipo: 'excesso', item: emCurso, minutos: 45, em: ISO(0, 50), fin: { payments: [], consultations: [emCurso], profile: { ...perfilVazio, credit: 500 } } });
  m.push({ tipo: 'excesso', item: emCurso, minutos: 45, em: ISO(0, 50), fin: null });
  // Saldo com estorno e transferência.
  const pEst = pagamento({ id: 'P3', amount: 120, purchase: { minutes: 60, amount: 120, table: 'first', priceVersionId: 'VAL-001' }, movements: [refund('M1', 30, -30, ISO(1))] });
  m.push({ tipo: 'conta', clientId: CLIENTE, pagamentos: [pEst], consultas: [consulta({ id: 'K3', durationSeconds: 1200 })], abertura: 0 });
  m.push({ tipo: 'conta', clientId: CLIENTE, pagamentos: [pEst], consultas: [consulta({ id: 'K3', durationSeconds: 1200 })], abertura: -25.5 });
  m.push({ tipo: 'conta', clientId: CLIENTE, pagamentos: [pagamento({ id: 'P4', amount: 59.2, confirmation: 'A confirmar' })], consultas: [], abertura: 10 });
  const transf = { id: 'T1', kind: 'balance-transfer', amount: 30, bankEffect: 0, creditEffect: -30, occurredAt: ISO(2), actor: 'Laya', note: 'Transferência', balanceTransfer: { operationId: 'OP1', sourceClientId: CLIENTE, sourceClient: 'A', targetClientId: '900200', targetClient: 'B', lot: { kind: 'purchase', paymentId: 'P5', cents: 3000, minutes: 10.135, unitValue: 2.96, minutesKnown: true } } };
  const pTransf = pagamento({ id: 'P5', amount: 88.8, purchase: { minutes: 30, amount: 88.8, table: 'regular', priceVersionId: 'VAL-001' }, movements: [transf] });
  m.push({ tipo: 'conta', clientId: CLIENTE, pagamentos: [pTransf], consultas: [], abertura: 0 });
  m.push({ tipo: 'conta', clientId: '900200', pagamentos: [pTransf], consultas: [], abertura: 0 });
  m.push({ tipo: 'tarifa', clientId: CLIENTE, em: ISO(5), pedidos: undefined, consultas: [], pagamentos: [pTransf], perfil: perfilVazio });
  m.push({ tipo: 'tarifa', clientId: '900200', em: ISO(5), pedidos: undefined, consultas: [], pagamentos: [pTransf], perfil: perfilVazio });
  m.push({ tipo: 'tarifa', clientId: CLIENTE, em: ISO(5), pedidos: 20, consultas: [], pagamentos: [pEst], perfil: { ...perfilVazio, credit: 29.6, openingCredit: { amount: 29.6, minutes: 10, purchaseMinutes: 15, purchaseAmount: 44.4 } } });
  return m;
}

function sorteado(n) {
  const r = semente(1000 + n);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const consultas = []; const pagamentos = [];
  const nc = 1 + Math.floor(r() * 4);
  for (let i = 0; i < nc; i += 1) {
    const status = pick(['Concluída', 'Concluída', 'Em curso', 'Cancelada', 'Não houve', 'Desistiu', 'Devolvida', 'Finalizada pelo tarólogo', 'Anulada']);
    const duracao = pick([0, 300, 600, 900, 1200, 1800, 2700, 3600, 3720]);
    const covKind = pick([null, null, 'Crédito', 'Crédito', 'Cortesia', 'Bônus', 'Complemento']);
    const lotes = r() < 0.4 ? [{ kind: 'purchase', paymentId: 'PX', cents: 8880, minutes: 30, unitValue: 2.96, minutesKnown: true, purchaseMinutes: 30, purchaseAmount: 88.8 }] : undefined;
    consultas.push(consulta({
      id: `KR${n}-${i}`, status, durationSeconds: status === 'Não houve' ? 0 : duracao, dia: i, paymentProfile: pick(['Pré-paga', 'Pré-paga', 'Pós-paga']),
      coverage: covKind ? { kind: covKind, minutes: pick([15, 20, 30]), ...(covKind === 'Complemento' ? { complementMode: pick(['prepaid', 'credit']), unitValue: pick([2.96, 3]) } : {}), ...(covKind === 'Crédito' && r() < 0.3 ? { balanceOnly: true, balanceAtLaunch: pick([29.6, 59.2, 100]) } : {}), ...(covKind === 'Crédito' ? { unitValue: 2.96 } : {}) } : undefined,
      billing: { minimumWaived: r() < 0.2, ...(r() < 0.5 ? { tariff: { table: 'regular', source: pick(['price-table', 'purchase', 'credit']), unitValue: pick([2.96, 2.5, 3.3]), resolvedAt: ISO(i), ...(lotes ? { creditLots: lotes, paymentIds: ['PX'] } : {}) } } : {}), ...(r() < 0.15 ? { chargeAdjustments: [{ id: 'A1', amount: 5, reason: 'x', at: ISO(i), by: 'Laya' }] } : {}), ...(r() < 0.1 ? { keepUnusedCashCredit: true } : {}) },
      minuteValue: r() < 0.3 ? pick([2.96, 0, 3.1]) : undefined,
      ...(r() < 0.2 ? { minuteBenefits: [{ id: `B${n}-${i}`, clientId: CLIENTE, kind: 'Bônus', minutes: 10, unitValue: 2.96, reason: 'x', grantedBy: 'Laya', grantedAt: ISO(-1), registeredBy: 'K', registeredAt: ISO(i) }], paidMinutesBeforeBenefits: pick([0, 15, 20]), ...(r() < 0.5 ? { benefitConsumptionOrder: 'benefits-first' } : {}) } : {}),
      ...(status === 'Anulada' && r() < 0.7 ? { cancellationReview: { status: 'unpaid', readerStatus: 'Concluída' } } : {}),
      ...(r() < 0.1 ? { specialPrice: { unitValue: 2 } } : {}), expectedMinutes: pick([undefined, 15, 30]),
    }));
  }
  const np = Math.floor(r() * 4);
  for (let i = 0; i < np; i += 1) {
    const amount = pick([35, 44.4, 46, 59.2, 67, 88.8, 120, 159.9, 50, 100.5]);
    const comprou = r() < 0.5;
    pagamentos.push(pagamento({
      id: `PR${n}-${i}`, amount, method: pick(['PIX', 'PIX', 'Cartão de crédito']), dia: i, status: pick(['Informado', 'Informado', 'Corrigido', 'Em conferência', 'Cancelado']),
      confirmation: pick([undefined, undefined, 'Confirmado', 'A confirmar']), linked: r() < 0.4 ? pick(consultas).id : undefined,
      purchase: comprou ? { minutes: pick([15, 20, 30, 60]), amount, table: pick(['first', 'regular', 'custom']), priceVersionId: 'VAL-001' } : undefined,
      cashUnitValue: !comprou && r() < 0.3 ? pick([2.96, 3.2]) : undefined,
      movements: r() < 0.2 ? [refund(`MR${n}-${i}`, amount / 2, -amount / 2, ISO(i + 1))] : undefined,
    }));
  }
  const perfil = { clientId: CLIENTE, name: 'Cliente Teste', paymentProfile: pick(['', 'Pré-pago', 'Pós-pago']), birthDate: '', whatsapp: '', credit: pick([0, 0, 29.6, -30, 88.8]), creditUpdatedAt: '', movements: [], neverTarotIds: [],
    ...(r() < 0.2 ? { minuteBenefits: [{ id: `PB${n}`, clientId: CLIENTE, kind: 'Cortesia', minutes: 15, unitValue: 2.96, reason: 'x', grantedBy: 'Laya', grantedAt: ISO(-2) }] } : {}), ...(r() < 0.15 ? { hasPriorConsultations: true } : {}) };
  if (perfil.credit === 29.6 && r() < 0.5) perfil.openingCredit = { amount: 29.6, minutes: 10, purchaseMinutes: 15, purchaseAmount: 44.4 };
  return { consultas, pagamentos, perfil };
}

const QUANTOS = 140;

/** `[{ tipo, ... }]`: manuais mais, para cada sorteio, acerto de cada consulta, conta, tarifa, cobertura e excesso. */
function gerarCenarios() {
  const lista = manuais();
  for (let n = 0; n < QUANTOS; n += 1) {
    const { consultas, pagamentos, perfil } = sorteado(n);
    for (const item of consultas) lista.push({ tipo: 'acerto', item, pagamentos: n % 5 === 0 ? undefined : pagamentos });
    lista.push({ tipo: 'conta', clientId: CLIENTE, pagamentos, consultas, abertura: perfil.credit });
    lista.push({ tipo: 'tarifa', clientId: CLIENTE, em: ISO(6), pedidos: n % 3 === 0 ? 20 : undefined, consultas, pagamentos, perfil, excepto: n % 4 === 0 ? consultas[0].id : undefined });
    lista.push({ tipo: 'cobertura', clientId: CLIENTE, pagamentos, consultas, perfil });
    const aberta = consultas.find((c) => c.status === 'Em curso');
    if (aberta) lista.push({ tipo: 'excesso', item: aberta, minutos: [20, 45, 70][n % 3], em: ISO(0, 90), fin: { payments: pagamentos, consultations: consultas, profile: perfil } });
  }
  return lista;
}

module.exports = { gerarCenarios, CLIENTE };
