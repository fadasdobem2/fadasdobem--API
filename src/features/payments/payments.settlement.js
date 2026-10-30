'use strict';

/**
 * Motor de liquidação do APROVADO e captura síncrona. Credita carteira/escrow pelo razão
 * (`postEntry`, centavos inteiros, idempotente), cria o lote e, como EFEITO SECUNDÁRIO, tenta reservar a
 * especialista (F-07: o dinheiro entrou, então o crédito nunca é revertido por causa da reserva).
 * Rejeitado/estorno/chargeback/em processamento ficam em `payments.settlement.events.js`.
 */
const { Op } = require('sequelize');
const { PaymentOrder, ClientCreditLot, Specialist, PendingDelivery } = require('../../models');
const { sequelize } = require('../../config/database');
const AppError = require('../../utils/AppError');
const {
  acquireSpecialistPaymentMutex,
  releaseSpecialistPaymentMutex,
} = require('../../providers/redis/specialist.payment.mutex');
const { resolveConsumptionModalitiesForLot } = require('./payments.modalities');
const {
  mapPaymentMethod,
  pickCreditCentsFromMp,
  normalizeUuidCandidate,
  enqueuePendingDeliveriesAfterCommit,
} = require('./payments.helpers');
const { toCents, centsToString, centsToNumber } = require('./payments.money');
const { postEntry } = require('./payments.posting');
const { POST_PAID_TERMINAL, transitionOrder } = require('./payments.states');
const {
  ensurePlatformSuspense,
  ensureClientWallet,
  ensureClientPacoteEscrow,
  applyMpSnapshotToOrder,
} = require('./payments.ledger');
const events = require('./payments.settlement.events');

/**
 * Tenta o mutex Redis da especialista SEM bloquear o crédito: ocupado significa apenas "não reservar agora";
 * Redis indisponível segue só com a trava de linha do Postgres.
 * @returns {Promise<{ skipReservation: boolean, release: () => Promise<void> }>}
 */
async function acquireReservationGuard(specialistId, orderId, clientId) {
  const noop = async () => {};
  if (!specialistId || !clientId) return { skipReservation: false, release: noop };
  try {
    const lk = await acquireSpecialistPaymentMutex(specialistId, orderId, 30);
    if (lk.ok) return { skipReservation: false, release: () => releaseSpecialistPaymentMutex(specialistId, orderId) };
    return { skipReservation: lk.reason === 'lock_held', release: noop };
  } catch (e) {
    // Redis fora do ar: segue só com a trava de linha do Postgres (SELECT FOR UPDATE + checagem da reserva).
    console.warn('[Payments] mutex da especialista indisponível, seguindo só com a trava do Postgres:', e?.message || e);
    return { skipReservation: false, release: noop };
  }
}

async function noteReservationSkipped(order, reason, t) {
  console.warn('[Payments] reserva da especialista não feita (crédito mantido)', { order_id: order.id, reason });
  await order.update(
    { checkout_context: { ...(order.checkout_context || {}), reservation_skipped: reason } },
    { transaction: t }
  );
}

/** Reserva best-effort + outbox T8. Nunca lança por causa da reserva. */
async function tryReserveSpecialist(order, ctx, specIdCandidate, skipReservation, t, deliveriesToEnqueueIds) {
  if (skipReservation) return noteReservationSkipped(order, 'MUTEX_BUSY', t);
  const specRow = await Specialist.findByPk(specIdCandidate, { transaction: t, lock: t.LOCK.UPDATE });
  if (!specRow) return noteReservationSkipped(order, 'SPECIALIST_NOT_FOUND', t);

  const nowMs = Date.now();
  const ru = specRow.reserved_until ? new Date(specRow.reserved_until).getTime() : NaN;
  const occupiedByOther =
    Number.isFinite(ru) &&
    ru > nowMs &&
    `${specRow.reserved_by_client_id || ''}` &&
    `${specRow.reserved_by_client_id}` !== `${order.client_id}`;
  if (occupiedByOther) return noteReservationSkipped(order, 'SPECIALIST_RESERVED_BY_OTHER', t);

  await specRow.update(
    { reserved_by_client_id: order.client_id, reserved_until: new Date(nowMs + 5 * 60 * 1000) },
    { transaction: t }
  );

  const acctRaw = `${ctx.chatwoot_account_id || process.env.CHATWOOT_ACCOUNT_ID || ''}`.trim();
  const convRaw = `${ctx.chatwoot_conversation_id || ''}`.trim();
  if (!(acctRaw && convRaw)) return undefined;

  const firstName =
    `${ctx.extracted_first_name || ctx.client_first_name || 'Cliente'}`.trim().slice(0, 48) || 'Cliente';
  const t8Variant = `${ctx.t8_variant || ctx.pending_delivery_variant || 'platform'}`.trim().toLowerCase();
  const existingPd = await PendingDelivery.findOne({
    where: { order_id: order.id, status: { [Op.in]: ['PENDING', 'SENT'] } },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (existingPd) return undefined;

  const rowPd = await PendingDelivery.create(
    {
      order_id: order.id,
      status: 'PENDING',
      attempts: 0,
      payload: {
        kind: 'T8_CHATWOOT',
        variant: ['platform', 'phone'].includes(t8Variant) ? t8Variant : 'platform',
        chatwootAccountId: acctRaw,
        conversationId: convRaw,
        clientFirstName: firstName,
        specialistId: specIdCandidate,
      },
    },
    { transaction: t }
  );
  deliveriesToEnqueueIds.push(rowPd.id);
  return undefined;
}

/**
 * Liquida a carteira/pacote do cliente. Idempotente: PAID repetido, webhook duplicado ou simultâneo
 * resultam em 1 lançamento, 1 lote e 1 incremento de saldo (trava da ordem + chave única do razão).
 * @param {{ id:string }} order ordem já travada FOR UPDATE pelo chamador
 * @param {Record<string, unknown>} mp snapshot Mercado Pago ou sintético
 * @param {import('sequelize').Transaction} t
 * @param {string[]} [deliveriesToEnqueueIds] IDs `pending_deliveries` a enfileirar só depois do commit
 * @param {{ skipReservation?: boolean }} [opts]
 */
async function handleApproved(order, mp, t, deliveriesToEnqueueIds = [], opts = {}) {
  await order.reload({ transaction: t, lock: t.LOCK.UPDATE });

  if (order.status === 'PAID' || POST_PAID_TERMINAL.includes(order.status)) {
    return;
  }

  await applyMpSnapshotToOrder(order, mp, t);

  const creditCents = pickCreditCentsFromMp(order, mp);
  if (!creditCents) {
    throw new AppError('Não foi possível determinar o valor do pagamento (líquido/bruto).', 500, null, false);
  }

  const grossCents = toCents(mp.transaction_amount);
  const orderCents = toCents(order.amount);
  if (grossCents != null && orderCents != null && grossCents !== orderCents) {
    console.error('[Payments] ALERTA: valor do MP difere do valor da ordem (crédito mantido)', {
      order_id: order.id,
      mp_gross: centsToString(grossCents),
      order_amount: centsToString(orderCents),
    });
  }

  /** PIX Lead FSM WhatsApp: sem `clients` até `convertLeadToClient`; a carteira é liquidada após a conversão. */
  if (Boolean(order.lead_id) && !order.client_id) {
    const nextCtx = {
      ...(order.checkout_context || {}),
      lead_fsm_v1: true,
      lead_fsm_credit_brl_reserved: centsToNumber(creditCents),
    };
    await transitionOrder(
      order,
      'PAID',
      { paid_at: new Date(mp.date_approved || Date.now()), payment_method: mapPaymentMethod(mp), checkout_context: nextCtx },
      t
    );
    return;
  }

  if (!order.client_id) {
    throw new AppError('Pagamento aprovado sem titular carteira válido.', 500, null, false);
  }

  const ctx = order.checkout_context || {};
  const ctypeRaw = `${ctx.credit_type || 'AVULSO'}`.trim().toUpperCase();
  const validTypes = ClientCreditLot.CREDIT_TYPES || ['AVULSO', 'PACOTE_SESSAO_UNICA'];
  const lotType = validTypes.includes(ctypeRaw) ? ctypeRaw : 'AVULSO';
  const isPacote = lotType === 'PACOTE_SESSAO_UNICA';

  const suspense = await ensurePlatformSuspense(t);
  const target = isPacote ? await ensureClientPacoteEscrow(order.client_id, t) : await ensureClientWallet(order.client_id, t);

  const posted = await postEntry(t, {
    debitId: suspense.id,
    creditId: target.id,
    amountCents: creditCents,
    referenceType: 'PAYMENT_ACCREDITED',
    referenceId: order.id,
    idempotencyKey: `mp-pay-approved-${mp.id}`,
    description: isPacote
      ? `Pré‑pago pacote sessão única creditado via MP ${mp.id}`
      : `Crédito carteira via gateway (MP ${mp.id})`,
    metadata: {
      mp_payment_id: String(mp.id),
      credit_cents: creditCents,
      gross_cents: grossCents,
      fee_cents: grossCents != null ? Math.max(0, grossCents - creditCents) : null,
      credit_rule: 'NET_MP_FALLBACK_GROSS',
      ledger_credit_account: isPacote ? 'CLIENT_PACOTE_ESCROW' : 'CLIENT_WALLET',
    },
    occurredAt: new Date(mp.date_approved || Date.now()),
  });

  const paidPatch = {
    paid_at: order.paid_at || new Date(mp.date_approved || Date.now()),
    payment_method: mapPaymentMethod(mp),
  };
  if (posted.duplicate) {
    await transitionOrder(order, 'PAID', paidPatch, t);
    return;
  }

  await ClientCreditLot.create(
    {
      client_id: order.client_id,
      payment_order_id: order.id,
      credit_type: lotType,
      initial_amount: centsToString(creditCents),
      remaining_amount: centsToString(creditCents),
      expires_at: null,
      notes: ctx.package_id ? `Pacote: ${ctx.package_id}` : ctx.label || null,
      consumption_modalities: isPacote ? resolveConsumptionModalitiesForLot(ctx, ctx.package_id ?? null) : null,
    },
    { transaction: t }
  );

  await transitionOrder(order, 'PAID', paidPatch, t);

  const specIdCandidate = normalizeUuidCandidate(ctx.specialist_id);
  if (specIdCandidate) {
    await tryReserveSpecialist(order, ctx, specIdCandidate, Boolean(opts.skipReservation), t, deliveriesToEnqueueIds);
  }
}

/**
 * Captura síncrona MP (instantânea ao criar pagamento): mutex Redis + Postgres + enqueue BullMQ
 * (**sem** anexar `raw_webhook_payload` - apenas notificação assíncrona faz o vault merge).
 *
 * @param {import('sequelize').Model} orderModel `PaymentOrder` carregado (pré-mp_response)
 */
async function finalizeApprovedMercadoSynchronously(orderModel, mpPayment) {
  const orderId = orderModel?.id;
  if (!orderId) throw new AppError('PaymentOrder ausente.', 500, null, false);

  const enqueueIdsCollector = [];

  const baseRow = await PaymentOrder.findByPk(orderId, { paranoid: true });
  if (!baseRow) {
    throw new AppError('PaymentOrder inexistente para liquidação MP síncrona.', 404, null, true);
  }
  const specPre = normalizeUuidCandidate((baseRow.checkout_context || {}).specialist_id);
  const guard = await acquireReservationGuard(specPre, orderId, baseRow.client_id);

  try {
    await sequelize.transaction(async (t) => {
      const locked = await PaymentOrder.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
      await handleApproved(locked, mpPayment, t, enqueueIdsCollector, { skipReservation: guard.skipReservation });
    });

    await enqueuePendingDeliveriesAfterCommit(enqueueIdsCollector);
  } finally {
    await guard.release();
  }
}

module.exports = {
  handleApproved,
  acquireReservationGuard,
  finalizeApprovedMercadoSynchronously,
  handleRejected: events.handleRejected,
  handleRefund: events.handleRefund,
  handleChargeback: events.handleChargeback,
  handleInProcess: events.handleInProcess,
};
