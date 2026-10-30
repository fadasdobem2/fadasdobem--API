'use strict';

/**
 * Idempotência da CRIAÇÃO de ordem (F-16): o front manda `Idempotency-Key` (header) ou
 * `idempotency_key` (corpo). A chave é gravada em `payment_orders.idempotency_key_internal`
 * (índice único parcial) com escopo do cliente, então duplo clique, retry de rede ou
 * Chatwoot repetido devolvem a MESMA ordem em vez de gerar outro PIX/crédito.
 */
const { Op } = require('sequelize');
const { PaymentOrder } = require('../../models');
const AppError = require('../../utils/AppError');
const { toCents } = require('./payments.money');
const { canTransition } = require('./payments.states');

function resolveIdempotencyKey(clientId, body = {}) {
  const raw = `${body.idempotency_key ?? ''}`.trim();
  if (!raw) return null;
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(raw)) {
    throw new AppError('Idempotency-Key inválida (8 a 100 caracteres: letras, números, . _ : -).', 400, null, true);
  }
  return `${clientId}:${raw}`;
}

function findOrderByIdempotencyKey(key) {
  return key ? PaymentOrder.findOne({ where: { idempotency_key_internal: key }, paranoid: true }) : null;
}

function isUniqueViolation(err) {
  return err?.name === 'SequelizeUniqueConstraintError' || err?.original?.code === '23505';
}

/** Mesma chave só vale para a mesma compra; outra compra com a chave reutilizada é erro do cliente. */
function assertSameRequest(prev, purchase) {
  if (toCents(prev.amount) !== toCents(purchase.amount_brl)) {
    throw new AppError('Idempotency-Key já usada em outra compra (valor diferente).', 409, { code: 'IDEMPOTENCY_CONFLICT' }, true);
  }
}

/**
 * Falha depois de a ordem existir. Se o MP já criou o pagamento, NÃO marca FAILED (o webhook conclui):
 * PROCESSING. Sem pagamento no MP, FAILED e libera a chave para nova tentativa. Atualização condicional
 * ao status atual: nunca sobrescreve PAID que o webhook tenha gravado no meio do caminho.
 */
async function markOrderAfterCheckoutError(order, err) {
  const detail = (err?.message?.slice?.(0, 256) || String(err)).slice(0, 256);
  const fresh = await PaymentOrder.findByPk(order.id, { paranoid: true }).catch(() => null);
  if (!fresh) return;
  if (fresh.mp_payment_id) {
    if (canTransition(fresh.status, 'PROCESSING') && ['PENDING', 'FAILED'].includes(fresh.status)) {
      await PaymentOrder.update(
        { status: 'PROCESSING', mp_status_detail: detail },
        { where: { id: order.id, status: { [Op.in]: ['PENDING', 'FAILED'] } } }
      ).catch(() => {});
    }
    return;
  }
  await PaymentOrder.update(
    { status: 'FAILED', mp_status_detail: detail, idempotency_key_internal: null },
    { where: { id: order.id, status: 'PENDING' } }
  ).catch(() => {});
}

module.exports = {
  resolveIdempotencyKey,
  findOrderByIdempotencyKey,
  isUniqueViolation,
  assertSameRequest,
  markOrderAfterCheckoutError,
};
