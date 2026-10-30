'use strict';

/**
 * Fábrica dos cenários do ouro das REGRAS da consulta no servidor (Maturacao/38): consultas, pagamentos e perfis montados à mão e por sorteio
 * com semente fixa (sem relógio nem aleatoriedade do ambiente). Todo valor é fictício. Mudar este arquivo muda o ouro (gere de novo).
 */

function semente(n) {
  let a = n >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const CLIENTE = '900100';
const DIA = (n) => `2026-10-${String(10 + n).padStart(2, '0')}T13:00:00-03:00`;
const ISO = (n, min = 0) => new Date(Date.parse(DIA(n)) + min * 60000).toISOString();
const COMPRA = (minutos, valor) => ({ minutes: minutos, amount: valor, table: 'regular', priceVersionId: 'VAL-001' });

function consulta(o) {
  const inicio = o.startedAt || ISO(o.dia || 0);
  const seg = o.durationSeconds ?? 0; const status = o.status || 'Concluída';
  return {
    id: o.id, clientId: o.clientId || CLIENTE, client: 'Cliente Teste', tarotId: 'osiris', tarot: 'Osíris', status, startedAt: inicio,
    ...(status === 'Em curso' ? {} : { endedAt: new Date(Date.parse(inicio) + seg * 1000).toISOString() }), durationSeconds: seg,
    paymentProfile: o.paymentProfile || 'Pré-paga', channel: 'WhatsApp', attendant: 'Khloe', observation: '', updatedAt: o.updatedAt || inicio, audit: [], commissionRate: 30,
    awaitingTarologistStart: false, sentToTarologistAt: inicio, tarologistStartedAt: inicio,
    ...(o.coverage ? { coverage: { registeredBy: 'Khloe', registeredAt: inicio, ...o.coverage } } : {}),
    billing: { minimumMinutes: 15, minimumWaived: false, funding: [], ...(o.billing || {}) },
    ...(o.expectedMinutes !== undefined ? { expectedMinutes: o.expectedMinutes, timeLimit: { kind: 'maximum', minutes: o.expectedMinutes } } : {}),
    ...(o.minuteBenefits ? { minuteBenefits: o.minuteBenefits } : {}), ...(o.paidMinutesBeforeBenefits !== undefined ? { paidMinutesBeforeBenefits: o.paidMinutesBeforeBenefits } : {}),
    ...(o.benefitConsumptionOrder ? { benefitConsumptionOrder: o.benefitConsumptionOrder } : {}),
    ...(o.cancellationReview ? { cancellationReview: o.cancellationReview } : {}), ...(o.cancellationPayout ? { cancellationPayout: o.cancellationPayout } : {}),
    ...(o.bonusGrant ? { bonusGrant: o.bonusGrant } : {}), ...(o.specialPrice ? { specialPrice: o.specialPrice } : {}), ...(o.minuteValue !== undefined ? { minuteValue: o.minuteValue } : {}),
    ...(o.tarologistFinishReport ? { tarologistFinishReport: o.tarologistFinishReport } : {}), ...(o.pauseHistory ? { pauseHistory: o.pauseHistory } : {}),
  };
}
function pagamento(o) {
  const quando = o.paidAt || ISO(o.dia || 0, -30);
  return { id: o.id, clientId: o.clientId || CLIENTE, client: 'Cliente Teste', amount: o.amount, method: 'PIX', paidAt: quando, informedAt: quando, informedBy: 'Khloe', status: o.status || 'Informado',
    ...(o.confirmation ? { confirmation: o.confirmation } : {}), ...(o.linked ? { linkedConsultationId: o.linked } : {}), ...(o.purchase ? { purchase: o.purchase } : {}), ...(o.movements ? { movements: o.movements } : {}) };
}
const perfilVazio = (extra = {}) => ({ clientId: CLIENTE, name: 'Cliente Teste', paymentProfile: 'Pré-pago', birthDate: '', whatsapp: '', credit: 0, creditUpdatedAt: '', movements: [], neverTarotIds: [], ...extra });
const cortesia = (id, minutos, extra = {}) => ({ id, clientId: CLIENTE, kind: 'Cortesia', minutes: minutos, unitValue: 2.96, reason: 'Gentileza', grantedBy: 'Laya', grantedAt: ISO(-3), ...extra });

/**
 * As variantes de saldo para a consulta em curso K1 (limite 30 min, crédito de 30 min): cada uma devolve `{ nome, consultas, pagamentos, perfil }`.
 * `K1` é a consulta que o teste faz encerrar, relatar e conferir.
 */
function variantesDaConferencia() {
  const k1 = (o = {}) => consulta({ id: 'K1', status: 'Em curso', durationSeconds: 0, coverage: { kind: 'Crédito', minutes: 30 }, expectedMinutes: 30, billing: { tariff: { table: 'regular', source: 'price-table', unitValue: 2.96, resolvedAt: ISO(0) } }, ...o });
  const pg = (id, valor, minutos, extra = {}) => pagamento({ id, amount: valor, linked: 'K1', purchase: COMPRA(minutos, valor), ...extra });
  const livre = (id, valor, minutos, extra = {}) => pagamento({ id, amount: valor, purchase: COMPRA(minutos, valor), dia: -1, ...extra });
  const v = [];
  v.push({ nome: 'cobre-so-30', consultas: [k1()], pagamentos: [pg('P1', 88.8, 30)], perfil: perfilVazio() });
  v.push({ nome: 'saldo-sobra-120', consultas: [k1()], pagamentos: [pg('P1', 88.8, 30), livre('P2', 266.4, 90, { confirmation: 'Confirmado' })], perfil: perfilVazio() });
  v.push({ nome: 'sem-saldo-extra', consultas: [k1()], pagamentos: [pg('P1', 88.8, 30), livre('P2', 88.8, 30, { confirmation: 'A confirmar' })], perfil: perfilVazio() });
  v.push({ nome: 'outra-em-curso', consultas: [k1(), consulta({ id: 'K2', status: 'Em curso', dia: 0 })], pagamentos: [pg('P1', 88.8, 30), livre('P2', 266.4, 90)], perfil: perfilVazio() });
  v.push({ nome: 'cortesia-no-perfil', consultas: [k1()], pagamentos: [pg('P1', 88.8, 30)], perfil: perfilVazio({ minuteBenefits: [cortesia('PB1', 20)] }) });
  v.push({ nome: 'cortesia-e-saldo', consultas: [k1()], pagamentos: [pg('P1', 88.8, 30), livre('P2', 118.4, 40)], perfil: perfilVazio({ minuteBenefits: [cortesia('PB1', 15)] }) });
  v.push({ nome: 'bonus-de-outra', consultas: [k1(), consulta({ id: 'K0', status: 'Cancelada', durationSeconds: 1200, dia: -2, coverage: { kind: 'Crédito', minutes: 20 }, bonusGrant: { minutes: 12, unitValue: 2.96, adjustment: 'cancellation', reason: 'Consulta anterior cancelada', grantedBy: 'Laya', grantedAt: ISO(-2) }, cancellationReview: { status: 'paid', readerStatus: 'Concluída', complaint: 'x', complaintReasons: [], shareComplaint: false } })], pagamentos: [pg('P1', 88.8, 30), pagamento({ id: 'P0', amount: 59.2, linked: 'K0', purchase: COMPRA(20, 59.2), dia: -2 })], perfil: perfilVazio() });
  v.push({ nome: 'pos-paga', consultas: [k1({ paymentProfile: 'Pós-paga', coverage: undefined, billing: { tariff: { table: 'regular', source: 'price-table', unitValue: 2.96, resolvedAt: ISO(0) } } })], pagamentos: [], perfil: perfilVazio({ paymentProfile: 'Pós-pago' }) });
  v.push({ nome: 'sem-pagamento', consultas: [k1()], pagamentos: [], perfil: perfilVazio() });
  return v;
}

module.exports = { semente, CLIENTE, DIA, ISO, COMPRA, consulta, pagamento, perfilVazio, cortesia, variantesDaConferencia };
