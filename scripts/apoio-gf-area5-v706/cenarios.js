'use strict';

/** Cenários fictícios (semente fixa) do ouro da área 5 v706: crédito arredondado, recibo dividido, permissões, recados por departamento, identidade do agendamento. */

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r = mulberry32(706);
const inteiro = (n) => Math.floor(r() * n);
const pick = (l) => l[inteiro(l.length)];
const chance = (p) => r() < p;
const centavos = (v) => Math.round(v * 100) / 100;
const iso = (ms) => new Date(ms).toISOString();
const BASE = Date.parse('2026-10-12T15:00:00.000Z');

/** Lotes de compra com minutos coerentes com o dinheiro (às vezes sem minutos conhecidos). */
function lotes() {
  return Array.from({ length: 1 + inteiro(3) }, (_, i) => {
    const unitValue = pick([2.96, 3, 2.5, 3.2, 2.88]); const minutes = centavos(1 + r() * 30); const cents = Math.round(minutes * unitValue * 100);
    return { kind: 'purchase', minutesKnown: chance(0.85), paymentId: `pg${i}`, cents, minutes, unitValue, usedMinutes: 0, usedConsultationMinutes: 0 };
  });
}

function pagamento(id, clientId, amount, extra = {}) {
  return { id, clientId, client: 'Cliente', amount, status: 'Informado', confirmation: 'Confirmado', method: 'PIX', paidAt: iso(BASE - 86400000), informedAt: iso(BASE - 86400000), movements: [], audit: [], ...extra };
}

/** Consulta concluída financiada por recibos que NÃO apontam para ela (fatias gravadas em billing.funding). */
function cenarioRecibo() {
  const cid = 'c1'; const n = 1 + inteiro(3);
  const pagamentos = Array.from({ length: 1 + inteiro(3) }, (_, i) => pagamento(`pg${i}`, chance(0.9) ? cid : 'c2', pick([35, 44.4, 88.8, 100.5, 59.2]), {
    ...(chance(0.2) ? { cashUnitValue: 2.96 } : {}), ...(chance(0.15) ? { unidentified: true } : {}), ...(chance(0.15) ? { status: 'Cancelado' } : {}),
    ...(chance(0.2) ? { movements: [{ id: `m${i}`, kind: 'refund', amount: 10, creditEffect: -10, bankEffect: -10, occurredAt: iso(BASE - 3600000) }] } : {}),
    ...(chance(0.15) ? { audit: [{ id: 'a', action: 'Pagamento desvinculado', actor: 'x', createdAt: iso(BASE), detail: 'Desvinculado da consulta k0.' }] } : {}) }));
  const consultas = Array.from({ length: n }, (_, k) => {
    const funding = pagamentos.filter(() => chance(0.8)).map((p) => {
      const amount = centavos(Math.min(p.amount, pick([10, 20, 30, p.amount / 2, p.amount])));
      return { paymentId: p.id, amount: chance(0.1) ? 0 : amount, minutes: centavos(amount / 2.96), ...(chance(0.4) ? { allocationBasis: { receiptAmount: p.amount, amount, minutes: centavos(amount / 2.96) } } : {}) };
    });
    return { id: `k${k}`, clientId: cid, tarotId: 'r1', tarot: 'L', client: 'Cliente', status: 'Concluída', startedAt: iso(BASE - 7200000), endedAt: iso(BASE - 3600000), durationSeconds: pick([600, 900, 1200, 1800]), audit: [], updatedAt: iso(BASE),
      billing: { minimumMinutes: 15, funding } };
  });
  pagamentos.forEach((p) => { if (chance(0.15) && consultas.length) p.linkedConsultationId = consultas[0].id; });
  return { consultas, pagamentos };
}

/** Consulta paga com crédito (lotes), com ou sem a fração autorizada. */
function cenarioCredito() {
  const ls = lotes(); const exato = ls.reduce((s, l) => s + l.minutes, 0);
  const arred = chance(0.6) ? { version: 1, minutes: pick([0.5, 0.2, centavos(Math.ceil(exato) - exato), 3]) } : undefined;
  const minutos = pick([5, 10, Math.floor(exato), Math.ceil(exato), Math.ceil(exato) + 2, 20, 40]);
  return { lotes: ls, pedidos: minutos, valor: pick([2.96, 3]), arred, exato };
}

/** Pedido de mais tempo com recibo confirmado separado (financialReview) para o saldo de crédito. */
function cenarioReserva() {
  const cid = 'c1'; const pagamentos = [pagamento('pg0', cid, pick([100, 88.8, 120]), { linkedConsultationId: 'k0', purchase: { minutes: 30, amount: 88.8, table: 'regular' } }), pagamento('pg1', cid, pick([35, 59.2, 20]))];
  const consultas = [{ id: 'k0', clientId: cid, tarotId: 'r1', tarot: 'L', client: 'Cliente', status: 'Concluída', startedAt: iso(BASE - 7200000), endedAt: iso(BASE - 3600000), durationSeconds: 900, audit: [], updatedAt: iso(BASE),
    coverage: { kind: 'Crédito', minutes: 15 }, billing: { minimumMinutes: 15, funding: [], tariff: { table: 'custom', source: 'credit', unitValue: 2.96, paymentIds: ['pg0'], resolvedAt: iso(BASE - 7200000), creditLots: [{ kind: 'purchase', minutesKnown: true, paymentId: 'pg0', cents: 4440, minutes: 15, unitValue: 2.96, usedMinutes: 0, usedConsultationMinutes: 0 }] } },
    financialReview: { status: pick(['awaiting-contact', 'awaiting-payment', 'approved', 'rejected']), at: iso(BASE - 3000000), reportedMinutes: pick([20, 25, 30, 45]) } }];
  return { consultas, pagamentos, perfil: chance(0.5) ? { id: cid, name: 'Cliente', credit: pick([0, 20, -10]), movements: [] } : null };
}

const PAPEIS = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];
function contaDe(papel, extra = {}) {
  return { id: `${papel}-1`, name: papel, email: `${papel}@x.test`, role: papel, commission: '', access: 'Acesso ativo', active: true, ...extra };
}
module.exports = { r, inteiro, pick, chance, centavos, iso, BASE, lotes, pagamento, cenarioRecibo, cenarioCredito, cenarioReserva, PAPEIS, contaDe };
