'use strict';

/**
 * Recibo dividido entre consultas (v706 da Nice). Porte de `features/domain/consultation-billing.ts`: `recordedSharedFunding`, `consultationFundingValue`
 * e `reconcileConsultationFundingPayments`. Um recebimento sem consulta ligada pode financiar fatias documentadas de várias consultas
 * (`billing.funding[]`, com `allocationBasis`). Um desvínculo explícito vence o retrato antigo; correção nominal do valor redistribui as fatias,
 * inclusive o resto sem dono, e movimentos bancários nunca reescrevem essas fatias. Ouro: scripts/gerar-ouro-gf-cobranca-v706.js. Puro.
 */

const dinheiro = (v) => Math.round(v * 100) / 100;
const confirmado = (p) => p.status !== 'Cancelado' && (p.confirmation ? p.confirmation === 'Confirmado' : p.status === 'Informado' || p.status === 'Corrigido');
const principal = (p) => Math.max(0, dinheiro(p.amount + (p.movements || []).reduce((s, m) => s + m.creditEffect, 0)));
const baseValida = (base) => Boolean(base) && [base.receiptAmount, base.amount, base.minutes].every((v) => Number.isFinite(v) && v > 0);

/** Fatia gravada na consulta para um recibo SEM consulta ligada; `undefined` quando não vale. */
function financiamentoCompartilhado(item, pagamento) {
  if (pagamento.unidentified || pagamento.clientId !== item.clientId || pagamento.linkedConsultationId) return undefined;
  // Um desvínculo explícito vence o retrato antigo da cobrança.
  const desvinculado = (pagamento.audit || []).some((e) => e.action === 'Pagamento desvinculado' && (String(e.detail).split('consulta ')[1] || '').split(/[.:;\s]/, 1)[0] === item.id);
  if (desvinculado) return undefined;
  const salvo = item.billing && (item.billing.funding || []).find((l) => l.paymentId === pagamento.id);
  if (!salvo || !Number.isFinite(salvo.amount) || salvo.amount < 0 || !Number.isFinite(salvo.minutes) || salvo.minutes < 0) return undefined;
  return (salvo.amount > 0 && salvo.minutes > 0) || baseValida(salvo.allocationBasis) ? salvo : undefined;
}

/** Cobertura monetária líquida de UMA fatia documentada (centavos para baixo: duas fatias não disputam o mesmo resto de devolução). */
function valorDaFatia(fatia, pagamento) {
  if (!confirmado(pagamento) || pagamento.unidentified || !Number.isFinite(pagamento.amount) || pagamento.amount <= 0) return 0;
  const parte = Math.min(1, Math.max(0, fatia.amount) / pagamento.amount);
  return Math.floor(Math.max(0, principal(pagamento)) * 100 * parte + 0.000001) / 100;
}

const reais = (v) => `R$ ${v.toFixed(2).replace('.', ',')}`;

/** Correção nominal do valor de um recibo compartilhado: refaz as fatias de cada consulta (maiores restos primeiro). */
function reconciliarFatias(consultas, antes, depois, auditoria) {
  const mudadas = new Map();
  for (const pagamento of depois) {
    const anterior = antes.find((p) => p.id === pagamento.id);
    if (!anterior || anterior.amount === pagamento.amount || anterior.amount <= 0 || !Number.isFinite(pagamento.amount) || pagamento.amount <= 0 || anterior.clientId !== pagamento.clientId || anterior.linkedConsultationId || pagamento.linkedConsultationId) continue;
    const fatias = consultas.flatMap((item) => {
      const salvo = financiamentoCompartilhado(item, anterior);
      if (!salvo || !financiamentoCompartilhado(item, pagamento)) return [];
      const guardada = salvo.allocationBasis;
      const base = baseValida(guardada) ? guardada : { receiptAmount: anterior.amount, amount: salvo.amount, minutes: salvo.minutes };
      return [{ item, salvo, base, peso: base.amount / base.receiptAmount }];
    });
    if (!fatias.length) continue;
    const peso = fatias.reduce((s, f) => s + f.peso, 0); const denominador = Math.max(1, peso); const alvo = Math.round(pagamento.amount * 100);
    const baldes = [...fatias.map((f) => ({ key: f.item.id, peso: f.peso })), { key: '￿unassigned', peso: Math.max(0, 1 - peso) }].map((balde) => {
      const bruto = alvo * balde.peso / denominador; const cents = Math.floor(bruto + 0.0000001);
      return { ...balde, cents, remainder: bruto - cents };
    });
    let sobra = alvo - baldes.reduce((s, x) => s + x.cents, 0);
    for (const balde of [...baldes].sort((a, c) => c.remainder - a.remainder || (a.key < c.key ? -1 : a.key > c.key ? 1 : 0))) { if (sobra <= 0) break; balde.cents += 1; sobra -= 1; }
    fatias.forEach((f, i) => {
      const amount = baldes[i].cents / 100; const minutes = f.base.minutes * amount / f.base.amount;
      const funding = mudadas.get(f.item.id) || f.item.billing.funding;
      mudadas.set(f.item.id, funding.map((l) => (l === f.salvo || l.paymentId === pagamento.id ? { ...l, amount, minutes, allocationBasis: f.base } : l)));
    });
  }
  if (!mudadas.size) return consultas;
  return consultas.map((item) => {
    const funding = mudadas.get(item.id);
    if (!funding) return item;
    const correcoes = funding.filter((l, i) => l.amount !== item.billing.funding[i].amount).map((l) => `${l.paymentId}: ${reais(item.billing.funding.find((o) => o.paymentId === l.paymentId).amount)} → ${reais(l.amount)}`);
    return { ...item, billing: { ...item.billing, funding }, ...(auditoria && correcoes.length ? { updatedAt: auditoria.at, audit: [...item.audit, { id: `funding:${auditoria.commandId}:${item.id}`, action: 'Dados corrigidos', actor: auditoria.actor, createdAt: auditoria.at, detail: `Distribuição proporcional atualizada após correção do valor recebido. ${correcoes.join('; ')}.` }] } : {}) };
  });
}

module.exports = { financiamentoCompartilhado, valorDaFatia, reconciliarFatias };
