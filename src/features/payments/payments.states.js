'use strict';

/**
 * Matriz de transições do status de PaymentOrder (F-05). Estados terminais não regridem:
 * REFUNDED e CHARGEBACK nunca voltam a PAID; `in_mediation`/`in_process` não rebaixam PAID.
 *
 * FAILED -> PAID e CANCELLED -> PAID existem de propósito: o dinheiro entrou no Mercado Pago
 * (a ordem pode ter sido marcada FAILED por erro local depois do pagamento), então se credita.
 * CHARGEBACK -> PAID (ganho de disputa) NÃO é implementado: depende de decisão da Nice.
 */
const TRANSITIONS = {
  PENDING: ['PROCESSING', 'PAID', 'FAILED', 'CANCELLED'],
  PROCESSING: ['PAID', 'FAILED', 'CANCELLED'],
  FAILED: ['PROCESSING', 'PAID'],
  CANCELLED: ['PAID'],
  PAID: ['PARTIALLY_REFUNDED', 'REFUNDED', 'CHARGEBACK'],
  PARTIALLY_REFUNDED: ['REFUNDED', 'CHARGEBACK'],
  REFUNDED: [],
  CHARGEBACK: [],
};

/** Estados em que o crédito já foi concedido e depois revertido (nunca recreditar). */
const POST_PAID_TERMINAL = ['REFUNDED', 'PARTIALLY_REFUNDED', 'CHARGEBACK'];

function canTransition(from, to) {
  const f = `${from || ''}`;
  const t = `${to || ''}`;
  if (f === t) return true;
  return (TRANSITIONS[f] || []).includes(t);
}

/**
 * Atualiza a ordem só se a transição for permitida. Devolve true se aplicou.
 * @param {import('sequelize').Model} order
 * @param {string} to
 * @param {Record<string, unknown>} patch campos extras (gravados junto, apenas se permitido)
 */
async function transitionOrder(order, to, patch, t) {
  if (!canTransition(order.status, to)) {
    console.warn('[Payments] transição de status ignorada', { order_id: order.id, from: order.status, to });
    return false;
  }
  await order.update({ ...patch, status: to }, { transaction: t });
  return true;
}

module.exports = { TRANSITIONS, POST_PAID_TERMINAL, canTransition, transitionOrder };
