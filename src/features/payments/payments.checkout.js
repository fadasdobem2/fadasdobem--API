'use strict';

/**
 * Checkout iniciado pelo cliente autenticado: PIX, cartão (Bricks/transparente)
 * e aprovação manual (operação interna/Chatwoot) sem gateway.
 */
const { randomUUID } = require('crypto');
const { PaymentOrder } = require('../../models');
const { sequelize } = require('../../config/database');
const AppError = require('../../utils/AppError');
const mpClient = require('../../providers/mercadopago/mercadopago.client');
const { clientColumn } = require('../../utils/clientRef.util');
const {
  resolveIdempotencyKey,
  findOrderByIdempotencyKey,
  isUniqueViolation,
  assertSameRequest,
  markOrderAfterCheckoutError,
} = require('./payments.idempotency');
const {
  resolvePurchaseInput,
  resolveNotificationUrl,
  normalizeUuidCandidate,
  enqueuePendingDeliveriesAfterCommit,
} = require('./payments.helpers');
const {
  finalizeApprovedMercadoSynchronously,
  handleApproved,
  handleRejected,
  handleInProcess,
} = require('./payments.settlement');

function pixResponse(order, mpPayment) {
  const td = mpPayment?.point_of_interaction?.transaction_data;
  return {
    payment_order_id: order.id,
    external_reference: order.external_reference,
    mp_payment_id: order.mp_payment_id != null ? String(order.mp_payment_id) : null,
    mp_status: mpPayment?.status ?? order.mp_status,
    pix: {
      qr_code: td?.qr_code || order.pix_qr_code || null,
      qr_code_base64: td?.qr_code_base64 || order.pix_qr_code_base64 || null,
      expires_at: order.pix_expires_at || mpPayment?.date_of_expiration || null,
    },
  };
}

function cardResponse(order) {
  return {
    payment_order_id: order.id,
    external_reference: order.external_reference,
    mp_payment_id: order.mp_payment_id != null ? String(order.mp_payment_id) : null,
    mp_status: order.mp_status,
    mp_status_detail: order.mp_status_detail || null,
    internal_status: order.status,
  };
}

/** Replay idempotente: devolve a ordem existente (ou 409 se ainda estiver sendo criada). */
function replayExisting(prev, purchase, build) {
  assertSameRequest(prev, purchase);
  if (!prev.mp_payment_id && prev.status === 'PENDING') {
    throw new AppError('Pedido com esta Idempotency-Key ainda está sendo criado.', 409, { code: 'IDEMPOTENT_IN_PROGRESS' }, true);
  }
  return build(prev);
}

/**
 * @param {import('express').Request['user']} user - Sequelize User com `client_profile`
 */
async function createPixCheckout(user, body = {}) {
  const client = user.client_profile;
  if (!client || !client.id) {
    throw new AppError('Apenas clientes autenticados podem gerar PIX.', 403, null, true);
  }

  const purchase = resolvePurchaseInput(body);
  const externalReference = randomUUID();
  const payerEmail = `${user.email || ''}`.trim();
  if (!payerEmail) {
    throw new AppError('E-mail do utilizador em falta - necessário para o Mercado Pago.', 400, null, true);
  }

  const idemKey = resolveIdempotencyKey(client.id, body);
  const prevPix = await findOrderByIdempotencyKey(idemKey);
  if (prevPix) return replayExisting(prevPix, purchase, pixResponse);

  const specOpt = normalizeUuidCandidate(body.specialist_id);
  const cwAcctOpt = `${body.chatwoot_account_id || ''}`.trim();
  const cwConvOpt = `${body.chatwoot_conversation_id || ''}`.trim();

  let order;
  try {
    order = await PaymentOrder.create({
      [clientColumn(user)]: client.id,
      user_id: user.id,
      external_reference: externalReference,
      idempotency_key_internal: idemKey,
      amount: purchase.amount_brl,
      currency: 'BRL',
      status: 'PENDING',
      payment_method: 'PIX',
      checkout_context: {
        package_id: purchase.package_id,
        credit_type: purchase.credit_type,
        label: purchase.label,
        ...(specOpt ? { specialist_id: specOpt } : {}),
        ...(cwAcctOpt ? { chatwoot_account_id: cwAcctOpt } : {}),
        ...(cwConvOpt ? { chatwoot_conversation_id: cwConvOpt } : {}),
      },
    });
  } catch (e) {
    if (!isUniqueViolation(e) || !idemKey) throw e;
    return replayExisting(await findOrderByIdempotencyKey(idemKey), purchase, pixResponse);
  }

  try {
    const mpPayment = await mpClient.createPixPayment({
      transaction_amount: purchase.amount_brl,
      description: `[Fadas do Bem] ${purchase.label}`.slice(0, 256),
      external_reference: externalReference,
      payer_email: payerEmail,
      payer_first_name: client.nome || client.tratar_por || 'Cliente',
      payer_last_name: '',
      notification_url: resolveNotificationUrl(),
    });

    const pixExpRaw = mpPayment.date_of_expiration;
    const pixExp = pixExpRaw ? new Date(pixExpRaw) : null;

    await order.update({
      mp_payment_id: String(mpPayment.id),
      pix_qr_code: mpPayment.point_of_interaction?.transaction_data?.qr_code || null,
      pix_qr_code_base64: mpPayment.point_of_interaction?.transaction_data?.qr_code_base64 || null,
      mp_status: mpPayment.status || null,
      mp_status_detail: mpPayment.status_detail || null,
      pix_expires_at: pixExp && Number.isFinite(pixExp.getTime()) ? pixExp : null,
    });

    if (mpPayment.status === 'approved') {
      await finalizeApprovedMercadoSynchronously(order, mpPayment);
    }

    return pixResponse(order, mpPayment);
  } catch (err) {
    await markOrderAfterCheckoutError(order, err);
    throw err;
  }
}

async function createCardCheckout(user, body = {}) {
  const client = user.client_profile;
  if (!client || !client.id) {
    throw new AppError('Apenas clientes autenticados podem pagar com cartão.', 403, null, true);
  }

  const token = `${body.token || ''}`.trim();
  const payment_method_id = `${body.payment_method_id || ''}`.trim();
  if (!token || !payment_method_id) {
    throw new AppError(
      'token e payment_method_id são obrigatórios (Bricks / checkout transparente).',
      400,
      null,
      true
    );
  }

  const purchase = resolvePurchaseInput(body);
  const externalReference = randomUUID();
  const payerEmail = `${user.email || ''}`.trim();
  if (!payerEmail) {
    throw new AppError('E-mail do utilizador em falta - necessário para o Mercado Pago.', 400, null, true);
  }
  const installments = parseInt(`${body.installments ?? 1}`, 10) || 1;

  const idemKeyCk = resolveIdempotencyKey(client.id, body);
  const prevCard = await findOrderByIdempotencyKey(idemKeyCk);
  if (prevCard) return replayExisting(prevCard, purchase, cardResponse);

  const specCk = normalizeUuidCandidate(body.specialist_id);
  const cwAcctCk = `${body.chatwoot_account_id || ''}`.trim();
  const cwConvCk = `${body.chatwoot_conversation_id || ''}`.trim();

  let order;
  try {
    order = await PaymentOrder.create({
      [clientColumn(user)]: client.id,
      user_id: user.id,
      external_reference: externalReference,
      idempotency_key_internal: idemKeyCk,
      amount: purchase.amount_brl,
      currency: 'BRL',
      status: 'PENDING',
      payment_method: 'CREDIT_CARD',
      checkout_context: {
        package_id: purchase.package_id,
        credit_type: purchase.credit_type,
        label: purchase.label,
        installments,
        ...(specCk ? { specialist_id: specCk } : {}),
        ...(cwAcctCk ? { chatwoot_account_id: cwAcctCk } : {}),
        ...(cwConvCk ? { chatwoot_conversation_id: cwConvCk } : {}),
      },
    });
  } catch (e) {
    if (!isUniqueViolation(e) || !idemKeyCk) throw e;
    return replayExisting(await findOrderByIdempotencyKey(idemKeyCk), purchase, cardResponse);
  }

  try {
    const payer_identification =
      body.payer_identification?.type && body.payer_identification?.number
        ? {
            type: String(body.payer_identification.type),
            number: String(body.payer_identification.number).replace(/\D/g, ''),
          }
        : undefined;

    const mpPayment = await mpClient.createCardPayment({
      transaction_amount: purchase.amount_brl,
      description: `[Fadas do Bem] ${purchase.label}`.slice(0, 256),
      external_reference: externalReference,
      token,
      payment_method_id,
      installments,
      issuer_id: body.issuer_id,
      payer_email: payerEmail,
      payer_identification,
      notification_url: resolveNotificationUrl(),
    });

    await order.update({
      mp_payment_id: String(mpPayment.id),
      mp_status: mpPayment.status || null,
      mp_status_detail: mpPayment.status_detail || null,
      card_last_four_digits: mpPayment.card?.last_four_digits || null,
      installments,
    });

    if (mpPayment.status === 'approved') {
      await finalizeApprovedMercadoSynchronously(order, mpPayment);
    } else {
      await sequelize.transaction(async (t) => {
        const locked = await PaymentOrder.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
        if (
          mpPayment.status === 'rejected' ||
          mpPayment.status === 'cancelled' ||
          mpPayment.status === 'canceled'
        ) {
          await handleRejected(locked, mpPayment, t);
        } else {
          await handleInProcess(locked, mpPayment, t);
        }
      });
    }

    const fresh = await PaymentOrder.findByPk(order.id, { paranoid: true });
    return cardResponse(fresh);
  } catch (err) {
    await markOrderAfterCheckoutError(order, err);
    throw err;
  }
}

/**
 * Aprovação manual (Chatwoot / operação interna): cria PaymentOrder já liquidada,
 * transação ledger suspense → carteira cliente e um ClientCreditLot.
 * Não usa Mercado Pago.
 *
 * @param {import('sequelize').Model & {
 *   client_profile?: { id?: string } | null;
 * }} user
 * @param {Record<string, unknown>} body mesmo contrato que `resolvePurchaseInput`: `amount` e/ou `package_id`.
 */
async function approveManualAttendancePayment(user, body = {}) {
  const client = user.client_profile;
  if (!client || !client.id) {
    throw new AppError('Perfil cliente em falta - não é possível lançar pagamento.', 403, null, true);
  }

  const purchase = resolvePurchaseInput(body);
  const externalReference = randomUUID();

  const idemKeyMan = resolveIdempotencyKey(client.id, body);
  const manualSummary = (o) => ({
    payment_order_id: o?.id,
    external_reference: o?.external_reference,
    status: o?.status,
    amount_brl: purchase.amount_brl,
    credit_type: purchase.credit_type,
    package_id: purchase.package_id,
  });
  const prevMan = await findOrderByIdempotencyKey(idemKeyMan);
  if (prevMan) {
    assertSameRequest(prevMan, purchase);
    return manualSummary(prevMan);
  }

  /** @type {string[]} */
  const postEnvelope = [];
  let createdPaymentOrderId = null;

  const manualSpec =
    normalizeUuidCandidate(body.specialist_id) || normalizeUuidCandidate(body.manual_specialist_id);
  const manualCwAcct = `${body.chatwoot_account_id || ''}`.trim();
  const manualCwConv = `${body.chatwoot_conversation_id || ''}`.trim();

  try {
    await sequelize.transaction(async (t) => {
      const order = await PaymentOrder.create(
        {
          client_id: client.id,
          user_id: user.id,
          external_reference: externalReference,
          idempotency_key_internal: idemKeyMan,
          amount: purchase.amount_brl,
          currency: 'BRL',
          status: 'PENDING',
          payment_method: 'UNKNOWN',
          checkout_context: {
            package_id: purchase.package_id,
            credit_type: purchase.credit_type,
            label: purchase.label,
            manual_attendance: true,
            ...(manualSpec ? { specialist_id: manualSpec } : {}),
            ...(manualCwAcct ? { chatwoot_account_id: manualCwAcct } : {}),
            ...(manualCwConv ? { chatwoot_conversation_id: manualCwConv } : {}),
          },
        },
        { transaction: t }
      );

      createdPaymentOrderId = order.id;

      const syntheticMpId = `manual-${order.id}`;
      const mpLike = {
        id: syntheticMpId,
        transaction_amount: purchase.amount_brl,
        transaction_details: { net_received_amount: purchase.amount_brl },
        status: 'approved',
        payment_type_id: 'manual_attendance',
        payment_method_id: 'manual_chatwoot',
        date_approved: new Date(),
      };

      const locked = await PaymentOrder.findByPk(order.id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      await handleApproved(locked, mpLike, t, postEnvelope);
    });
  } catch (e) {
    if (!isUniqueViolation(e) || !idemKeyMan) throw e;
    const again = await findOrderByIdempotencyKey(idemKeyMan);
    assertSameRequest(again, purchase);
    return manualSummary(again);
  }

  await enqueuePendingDeliveriesAfterCommit(postEnvelope);

  const locked = await PaymentOrder.findByPk(createdPaymentOrderId, { paranoid: true });

  return manualSummary(locked || { id: createdPaymentOrderId, external_reference: externalReference });
}

module.exports = { createPixCheckout, createCardCheckout, approveManualAttendancePayment };
