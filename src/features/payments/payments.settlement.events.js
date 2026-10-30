'use strict';

/**
 * Eventos do Mercado Pago que NÃO creditam: rejeitado, estorno, chargeback e em processamento.
 * Todos respeitam a matriz de transições (`payments.states.js`): pedido pago/estornado não regride e
 * `in_mediation`/`in_process` não rebaixam PAID (F-05). A ordem já chega travada (FOR UPDATE).
 */
const { cloneJson } = require('./payments.helpers');
const { applyMpSnapshotToOrder } = require('./payments.ledger');
const { reverseOrderCredit } = require('./payments.reversal');
const { canTransition, transitionOrder } = require('./payments.states');

async function handleRejected(order, mp, t) {
  if (!canTransition(order.status, 'FAILED')) {
    console.warn('[Payments] rejeição ignorada: pedido já está em', order.status, { mp: mp.id });
    return;
  }
  await applyMpSnapshotToOrder(order, mp, t);
  await transitionOrder(
    order,
    'FAILED',
    { mp_status_detail: `${mp.status_detail || ''}`.trim() || `${mp.status || ''}`.trim() || 'unknown' },
    t
  );
}

async function handleRefund(order, mp, t) {
  await applyMpSnapshotToOrder(order, mp, t);
  await order.reload({ transaction: t, lock: t.LOCK.UPDATE });
  const { reversedCents, lossCents } = await reverseOrderCredit(order, mp, 'REFUND', t);
  const to = mp.status === 'partially_refunded' ? 'PARTIALLY_REFUNDED' : 'REFUNDED';
  const patch = { refund_reason: mp.status_detail || 'refunded' };
  if (reversedCents + lossCents > 0 || order.status === 'PAID') patch.refunded_at = new Date();
  await transitionOrder(order, to, patch, t);
}

async function handleChargeback(order, mp, t) {
  await applyMpSnapshotToOrder(order, mp, t);
  await order.reload({ transaction: t, lock: t.LOCK.UPDATE });
  await reverseOrderCredit(order, mp, 'CHARGEBACK', t);
  if (order.status === 'CHARGEBACK') return;
  const notes = (() => {
    const s = JSON.stringify(cloneJson(mp) || {});
    return s.length > 12000 ? `${s.slice(0, 12000)}…` : s;
  })();
  await transitionOrder(
    order,
    'CHARGEBACK',
    {
      chargeback_opened_at: new Date(),
      chargeback_reason_code: mp.status_detail || 'charged_back',
      chargeback_notes: notes,
    },
    t
  );
}

async function handleInProcess(order, mp, t) {
  if (order.status === 'PAID') {
    // Contestação aberta em ordem paga: só registra o retrato do MP, o status segue PAID.
    if (mp.status === 'in_mediation') await applyMpSnapshotToOrder(order, mp, t);
    return;
  }
  if (!canTransition(order.status, 'PROCESSING')) return;
  await applyMpSnapshotToOrder(order, mp, t);
  await transitionOrder(order, 'PROCESSING', {}, t);
}

module.exports = { handleRejected, handleRefund, handleChargeback, handleInProcess };
