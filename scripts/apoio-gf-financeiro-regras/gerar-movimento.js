'use strict';

/**
 * Ouro de MOVIMENTO financeiro (Maturacao/42, itens 1 e 3): roda `recordPaymentMovement`, `recordRemainingCreditRefund` (`cash-ledger.ts`,
 * `payment-credit-refund.ts`) e `correctPaymentMovement` (`payment-movement-correction.ts`) REAIS do front sobre históricos sorteados.
 * Cada passo do histórico vira um cenário de `registrar` (com a recusa do front, quando há) e cada movimento final vira cenários de `corrigir`.
 */

const { AGORA, CLIENTE, semente, dia, tentar, limpar, perfil, consulta, BASES, criarBase } = require('./fabrica');

const ATOR = 'Clara';
const TIPOS = ['refund', 'refund', 'refund-credito', 'dispute', 'dispute-debit', 'dispute-rejected', 'dispute-accepted', 'dispute-return', 'payment-missing', 'scheduled-unpaid', 'payment-reconciled'];

/** Contextos de crédito (o front passa pagamentos, consultas e perfil da cliente). */
function contextos(p) {
  const lote = { kind: 'purchase', paymentId: p.id, cents: 4440, minutes: 15, unitValue: 2.96, minutesKnown: true, purchaseMinutes: 15, purchaseAmount: 44.4 };
  const uso = consulta({ id: `K-${p.id}`, durationSeconds: 900, dia: 2, coverage: { kind: 'Crédito', minutes: 15 }, billing: { tariff: { table: 'regular', source: 'credit', unitValue: 2.96, resolvedAt: dia(2), creditLots: [lote], paymentIds: [p.id] } } });
  return [[], [uso]];
}

function sorteioDeEntrada(r, p, estado) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const tipo = pick(TIPOS);
  const movs = estado.movements || [];
  const valor = pick([10, 20, 30, 44.4, 50, 60, 88.8, 20, 30, 40, 10, 0.01, p.amount, (p.grossAmount ?? p.amount) / 2, (p.grossAmount ?? p.amount) / 4, 0, -5, 500]);
  const pai = movs.length && r() < 0.93 ? pick(movs).id : 'inexistente';
  const entrada = { kind: tipo === 'refund-credito' ? 'refund' : tipo, amount: valor, bankMoved: tipo === 'dispute-debit' || tipo.startsWith('dispute') ? r() < 0.6 : tipo.startsWith('refund') ? r() < 0.95 : false, note: pick(['', 'Teste de movimento.', 'Teste de movimento.', 'Conferido no extrato.', 'Teste de movimento.', 'Conferido no extrato.', 'x'.repeat(4001), 'a\u0001b']), occurredAt: pick([dia(5), dia(3), dia(8), dia(1), dia(5), dia(3), dia(8), dia(1), dia(5), dia(6), 'ontem']) };
  if (['dispute-debit', 'dispute-rejected', 'dispute-accepted', 'dispute-return', 'payment-reconciled'].includes(tipo)) entrada.parentId = pai;
  if (tipo === 'refund') entrada.creditAmount = pick([undefined, undefined, valor, valor / 2, 0, valor + 1, -1]);
  if (tipo === 'refund' && r() < 0.2) { entrada.agendaItemId = 'AG-1'; entrada.agendaTarotId = 'osiris'; }
  return { tipo, entrada };
}

function gerar(fr, quantos = 220) {
  const cenarios = [];
  for (let n = 0; n < quantos; n += 1) {
    const r = semente(7000 + n);
    const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const base = BASES[n % BASES.length];
    let p = criarBase(fr, base);
    const consultas = pick(contextos(p));
    const passos = 1 + Math.floor(r() * 5);
    for (let i = 0; i < passos; i += 1) {
      const { tipo, entrada } = sorteioDeEntrada(r, p, p);
      const id = `OP-${n}-${i}:movement`;
      const contexto = { payments: [p], consultations: consultas, profile: perfil(CLIENTE, { credit: pick([0, 0, 50]) }) };
      if (tipo === 'refund-credito') {
        const credito = { amount: entrada.amount, bankAmount: pick([undefined, entrada.amount, entrada.amount * 0.9]), note: entrada.note, occurredAt: entrada.occurredAt, ...(entrada.agendaItemId ? { agendaItemId: entrada.agendaItemId } : {}) };
        const res = tentar(() => fr.credito.recordRemainingCreditRefund(p, credito, contexto, ATOR, id, AGORA));
        cenarios.push({ tipo: 'credito', antes: p, contexto, entrada: credito, ator: ATOR, id, agora: AGORA, esperado: res.ok ? { ok: limpar(res.ok) } : { erro: res.erro } });
        if (res.ok) p = res.ok;
        continue;
      }
      const res = tentar(() => fr.livro.recordPaymentMovement(p, entrada, ATOR, id, AGORA));
      cenarios.push({ tipo: 'registrar', antes: p, entrada, ator: ATOR, id, agora: AGORA, esperado: res.ok ? { ok: limpar(res.ok) } : { erro: res.erro } });
      if (res.ok) p = res.ok;
    }
    const movs = p.movements || [];
    for (const m of movs) {
      const variantes = [
        { amount: m.amount, occurredAt: m.occurredAt, note: m.note }, { amount: m.amount, occurredAt: m.occurredAt, note: `${m.note} (revisado)` },
        { amount: Math.round(m.amount * 50) / 100, occurredAt: m.occurredAt, note: m.note }, { amount: m.amount + 5, occurredAt: m.occurredAt, note: m.note },
        { amount: m.amount, occurredAt: dia(9), note: m.note }, { amount: 0, occurredAt: m.occurredAt, note: m.note }, { amount: m.amount, occurredAt: 'ontem', note: m.note },
        { amount: m.amount, occurredAt: dia(4), note: 'Nota nova.' }, { amount: (p.grossAmount ?? p.amount) + 1, occurredAt: m.occurredAt, note: m.note }, { amount: m.amount * 2, occurredAt: dia(2), note: '' },
      ];
      for (const v of variantes) {
        const contexto = { payments: [p], consultations: consultas, profile: perfil(CLIENTE, { credit: 0 }) };
        const res = tentar(() => fr.correcao.correctPaymentMovement(p, m.id, v, ATOR, AGORA, contexto));
        cenarios.push({ tipo: 'corrigir', antes: p, contexto, id: m.id, entrada: v, ator: ATOR, agora: AGORA, esperado: res.ok ? { ok: limpar(res.ok) } : { erro: res.erro } });
      }
    }
    if (movs.length) { // sem contexto de crédito: a frase própria do front
      const m = movs[0];
      const res = tentar(() => fr.correcao.correctPaymentMovement(p, m.id, { amount: m.amount + 1, occurredAt: m.occurredAt, note: m.note }, ATOR, AGORA, undefined));
      cenarios.push({ tipo: 'corrigir', antes: p, contexto: null, id: m.id, entrada: { amount: m.amount + 1, occurredAt: m.occurredAt, note: m.note }, ator: ATOR, agora: AGORA, esperado: res.ok ? { ok: limpar(res.ok) } : { erro: res.erro } });
    }
  }
  return cenarios;
}

module.exports = { gerar, ATOR };
