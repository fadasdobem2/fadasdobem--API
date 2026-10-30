'use strict';

/**
 * Pipeline HTTP síncrono do webhook Mercado Pago: revalida o pagamento na API MP
 * (GET /v1/payments/:id), guarda o vault bruto e despacha para o motor de
 * liquidação conforme o status. Erros 503 incentivam retry pela fila do MP.
 */
const { PaymentOrder } = require('../../models');
const { sequelize } = require('../../config/database');
const AppError = require('../../utils/AppError');
const mpClient = require('../../providers/mercadopago/mercadopago.client');
const {
  cloneJson,
  redactWebhookHeaders,
  assertNoTestNotificationInProduction,
  isMpWebhookVerbose,
  safeJsonForLog,
  appendWebhookVault,
  normalizeUuidCandidate,
  enqueuePendingDeliveriesAfterCommit,
} = require('./payments.helpers');
const { applyMpSnapshotToOrder } = require('./payments.ledger');
const {
  handleApproved,
  acquireReservationGuard,
  handleRejected,
  handleRefund,
  handleChargeback,
  handleInProcess,
} = require('./payments.settlement');
const { maybeNotifyLeadFsmAfterMpApproved } = require('./payments.lead-fsm');

/**
 * Pipeline HTTP síncrono (controlador aguarda) - erros recuperáveis (503) incentivam retries do Mercado Pago.
 *
 * @param {{
 *   body: object;
 *   query?: object;
 *   headers?: Record<string, string | string[] | undefined>;
 * }} envelope
 */
async function processMercadoPagoWebhookAsync(envelope = {}) {
  const body = envelope.body && typeof envelope.body === 'object' ? envelope.body : {};

  console.log('[MP:Webhook] --- início pipeline notificação ---');

  if (isMpWebhookVerbose()) {
    console.log('[MP:Webhook] envelope (payload bruto + query)', {
      query: envelope.query || {},
      body_json: safeJsonForLog(body, 48000),
    });
  } else {
    console.log('[MP:Webhook] resumo notificação', {
      action: body.action,
      type: body.type,
      live_mode: body.live_mode,
      data_id: body.data?.id,
      api_version: body.api_version,
      date_created: body.date_created,
    });
  }

  if (!assertNoTestNotificationInProduction(body, null)) {
    console.warn('[MP:Webhook] abortado pela trava production/sandbox (payload).');
    return;
  }

  let paymentId = body?.data?.id ?? envelope.query?.['data.id'];
  if (paymentId == null && envelope.query?.data?.id != null) {
    paymentId = envelope.query.data.id;
  }

  paymentId = paymentId != null ? String(paymentId).trim() : '';
  if (!paymentId) {
    console.warn('[MP:Webhook] sem data.id no corpo/query - ignorado');
    return;
  }

  let mpPayment;
  try {
    mpPayment = await mpClient.getPaymentById(paymentId);
  } catch (e) {
    const is404 =
      (e instanceof AppError && e.statusCode === 404) ||
      `${e?.message || ''}`.includes('não encontrado');
    if (is404) {
      console.warn(
        '[MP:Webhook] pagamento inexistente na API MP - normal no "Enviar teste" do painel (ID fictício, ex.: 123456). Ignorado.',
        { payment_id: paymentId }
      );
      return;
    }
    console.error('[MP:Webhook] getPaymentById falhou:', e?.message || e);
    throw e;
  }

  if (!assertNoTestNotificationInProduction(body, mpPayment)) {
    console.warn('[MP:Webhook] abortado pela trava production/sandbox (GET payment live_mode).', {
      payment_id: mpPayment?.id,
    });
    return;
  }

  if (isMpWebhookVerbose()) {
    console.log(
      '[MP:Webhook] GET /v1/payments/:id - resposta API',
      safeJsonForLog(mpPayment, 48000)
    );
  } else {
    console.log('[MP:Webhook] GET /v1/payments/:id - resumo', {
      id: mpPayment.id,
      status: mpPayment.status,
      status_detail: mpPayment.status_detail,
      live_mode: mpPayment.live_mode,
      external_reference: mpPayment.external_reference,
      transaction_amount: mpPayment.transaction_amount,
      net_received: mpPayment.transaction_details?.net_received_amount,
    });
  }

  const extRef = `${mpPayment.external_reference || ''}`.trim();
  let order =
    extRef &&
    (await PaymentOrder.findOne({
      where: { external_reference: extRef },
      paranoid: true,
    }));

  if (!order) {
    order = await PaymentOrder.findOne({
      where: { mp_payment_id: String(mpPayment.id) },
      paranoid: true,
    });
  }

  const vaultEntry = {
    gateway: 'mercadopago',
    notification: cloneJson(body),
    mp_payment_snapshot: {
      id: mpPayment.id,
      status: mpPayment.status,
      status_detail: mpPayment.status_detail,
    },
    headers: redactWebhookHeaders(envelope.headers || {}),
    query: cloneJson(envelope.query) || envelope.query || {},
  };

  if (!order) {
    console.warn('[MP:Webhook] PaymentOrder não encontrado', {
      external_reference: extRef || null,
      mp_id: mpPayment.id,
    });
    return;
  }

  console.log('[MP:Webhook] PaymentOrder encontrado', {
    payment_order_id: order.id,
    external_reference: order.external_reference,
    status_atual_bd: order.status,
  });

  const approvalsOutboxCollector = [];

  if (mpPayment.status === 'approved') {
    const specPre = normalizeUuidCandidate((order.checkout_context || {}).specialist_id);
    /** F-07: mutex ocupado só impede a RESERVA da especialista; o crédito do dinheiro recebido sempre acontece. */
    const guard = await acquireReservationGuard(specPre, order.id, order.client_id);

    try {
      await sequelize.transaction(async (t) => {
        const locked = await PaymentOrder.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
        const mergedVault = appendWebhookVault(locked.raw_webhook_payload, vaultEntry);
        await locked.update({ raw_webhook_payload: mergedVault }, { transaction: t });
        await handleApproved(locked, mpPayment, t, approvalsOutboxCollector, {
          skipReservation: guard.skipReservation,
        });
      });
    } finally {
      await guard.release();
    }

    await enqueuePendingDeliveriesAfterCommit(approvalsOutboxCollector);
  } else {
    await sequelize.transaction(async (t) => {
      const locked = await PaymentOrder.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
      const mergedVault = appendWebhookVault(locked.raw_webhook_payload, vaultEntry);
      await locked.update({ raw_webhook_payload: mergedVault }, { transaction: t });

      switch (mpPayment.status) {
        case 'rejected':
        case 'cancelled':
        case 'canceled':
          await handleRejected(locked, mpPayment, t);
          break;

        case 'refunded':
        case 'partially_refunded':
          await handleRefund(locked, mpPayment, t);
          break;

        case 'charged_back':
          await handleChargeback(locked, mpPayment, t);
          break;

        case 'pending':
        case 'in_process':
        case 'in_mediation':
          await handleInProcess(locked, mpPayment, t);
          break;

        default:
          await applyMpSnapshotToOrder(locked, mpPayment, t);
          console.log('[MP:Webhook] status não mapeado em switch', mpPayment.status);
      }
    });
  }

  const refreshed = await PaymentOrder.findByPk(order.id, { paranoid: true });
  await maybeNotifyLeadFsmAfterMpApproved(refreshed, `${mpPayment.status || ''}`);

  console.log('[MP:Webhook] --- fim processamento ---', {
    payment_order_id: order.id,
    mp_payment_id: mpPayment.id,
    mp_status: mpPayment.status,
  });
}

module.exports = { processMercadoPagoWebhookAsync };
