'use strict';

/**
 * Pagamentos do funil de LEAD via WhatsApp (Chatwoot FSM): geração de PIX antes
 * da conta existir, reconciliação de créditos após a conversão lead→cliente e
 * notificação de captura de volta ao fluxo Chatwoot.
 */
const { randomUUID } = require('crypto');
const { Op } = require('sequelize');
const { PaymentOrder, ClientCreditLot, Lead } = require('../../models');
const { sequelize } = require('../../config/database');
const AppError = require('../../utils/AppError');
const mpClient = require('../../providers/mercadopago/mercadopago.client');
const { resolveConsumptionModalitiesForLot } = require('./payments.modalities');
const {
  pickCreditCentsFromMp,
  normalizeUuidCandidate,
  resolveNotificationUrl,
  enqueuePendingDeliveriesAfterCommit,
} = require('./payments.helpers');
const { roundMoney, toCents, centsToString } = require('./payments.money');
const { postEntry } = require('./payments.posting');
const { markOrderAfterCheckoutError } = require('./payments.idempotency');
const {
  ensurePlatformSuspense,
  ensureClientWallet,
  ensureClientPacoteEscrow,
} = require('./payments.ledger');
const { handleApproved } = require('./payments.settlement');

function formatFsmBrlLabel(amountDec) {
  const n = Number(amountDec);
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
  } catch {
    const s = n.toFixed(2).replace('.', ',');
    return `R$${s}`;
  }
}

async function reconcileLeadFsmPaymentsAfterConversion(leadId, clientId, t) {
  const orders = await PaymentOrder.findAll({
    where: { lead_id: leadId, status: 'PAID', client_id: { [Op.is]: null } },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  const mpLikeFromOrder = (ord) => ({
    id: ord.mp_payment_id,
    transaction_amount: ord.mp_transaction_amount ?? ord.amount,
    transaction_details: { net_received_amount: ord.mp_net_received_amount ?? ord.amount },
    payment_type_id: 'bank_transfer',
    payment_method_id: 'pix',
    date_approved: ord.paid_at || undefined,
    status_detail: ord.mp_status_detail,
    status: 'approved',
  });

  const suspense = await ensurePlatformSuspense(t);

  for (const ord of orders) {
    await ord.update({ client_id: clientId }, { transaction: t });
    await ord.reload({ transaction: t });

    const reserved = toCents((ord.checkout_context || {}).lead_fsm_credit_brl_reserved);
    const creditCents = reserved && reserved > 0 ? reserved : pickCreditCentsFromMp(ord, mpLikeFromOrder(ord));
    if (!creditCents) continue;

    const ctx = ord.checkout_context || {};
    const creditType = ctx.credit_type || 'PACOTE_SESSAO_UNICA';
    const validTypes = ClientCreditLot.CREDIT_TYPES || ['AVULSO', 'PACOTE_SESSAO_UNICA'];
    const lotType = validTypes.includes(creditType) ? creditType : 'AVULSO';

    const ledgerCred =
      lotType === 'PACOTE_SESSAO_UNICA'
        ? await ensureClientPacoteEscrow(clientId, t)
        : await ensureClientWallet(clientId, t);

    const posted = await postEntry(t, {
      debitId: suspense.id,
      creditId: ledgerCred.id,
      amountCents: creditCents,
      referenceType: 'PAYMENT_TOPUP',
      referenceId: ord.id,
      idempotencyKey: `mp-pay-fsmconverted-${String(ord.mp_payment_id || ord.id)}`,
      description: `Recarga PIX Lead WhatsApp reconciliada (pedido ${ord.id})`,
      metadata: {
        mp_payment_id: String(ord.mp_payment_id || ''),
        lead_fsm: true,
        lead_id: String(leadId),
        target: lotType === 'PACOTE_SESSAO_UNICA' ? 'CLIENT_PACOTE_ESCROW' : 'CLIENT_WALLET',
      },
      occurredAt: new Date(ord.paid_at || Date.now()),
    });
    if (posted.duplicate) continue;

    await ClientCreditLot.create(
      {
        client_id: clientId,
        payment_order_id: ord.id,
        credit_type: lotType,
        initial_amount: centsToString(creditCents),
        remaining_amount: centsToString(creditCents),
        expires_at: null,
        notes: ctx.package_id ? `Pacote: ${ctx.package_id}` : ctx.label || 'Lead FSM PIX',
        consumption_modalities:
          lotType === 'PACOTE_SESSAO_UNICA'
            ? resolveConsumptionModalitiesForLot(ctx, ctx.package_id_fsm ?? null)
            : null,
      },
      { transaction: t }
    );
  }
}

async function createPixCheckoutForLeadFsm({
  leadId,
  amountBrlDecimal,
  label,
  packageIdFsm,
  chatwootAccountId,
  conversationId,
}) {
  const leadRow = await Lead.findByPk(leadId, { paranoid: true });
  if (!leadRow) throw new AppError('Lead não encontrado para gerar PIX.', 404, null, true);

  const specialistFromLead = normalizeUuidCandidate(leadRow.interested_specialist_id);

  const domain = `${process.env.LEAD_FSM_MP_GUEST_EMAIL_DOMAIN || 'clients.fadasdobem.invalid'}`.trim().replace(/^@/, '');
  const slug = `${leadId}`.replace(/-/g, '').slice(0, 12).toLowerCase();
  const guestEmail = `${process.env.LEAD_FSM_MP_GUEST_MAILBOX || 'lead.pay'}+fsm.${slug}@${domain}`.toLowerCase();

  const amt = roundMoney(amountBrlDecimal);
  if (!amt) throw new AppError('Valor PIX inválido.', 400, null, true);

  const externalReference = randomUUID();
  const acctId = `${chatwootAccountId || process.env.CHATWOOT_ACCOUNT_ID || ''}`.trim();

  const order = await PaymentOrder.create({
    client_id: null,
    lead_id: leadId,
    user_id: null,
    external_reference: externalReference,
    amount: amt,
    currency: 'BRL',
    status: 'PENDING',
    payment_method: 'PIX',
    checkout_context: {
      lead_fsm_v1: true,
      credit_type: 'PACOTE_SESSAO_UNICA',
      label: `${label || 'Consulta primeira vitrine WhatsApp'}`.slice(0, 256),
      package_id_fsm: packageIdFsm || null,
      chatwoot_account_id: acctId,
      chatwoot_conversation_id: `${conversationId || ''}`,
      amount_display_fsm: formatFsmBrlLabel(amt),
      ...(specialistFromLead ? { specialist_id: specialistFromLead } : {}),
    },
  });

  let mpPayment;
  try {
    mpPayment = await mpClient.createPixPayment({
      transaction_amount: amt,
      description: `[Fadas do Bem WhatsApp Lead] ${label || 'Pacote'}`.slice(0, 256),
      external_reference: externalReference,
      payer_email: guestEmail,
      payer_first_name: 'Cliente',
      payer_last_name: 'WhatsApp Lead',
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
      mp_transaction_amount:
        toCents(mpPayment.transaction_amount) != null
          ? centsToString(toCents(mpPayment.transaction_amount))
          : centsToString(toCents(amt)),
      mp_net_received_amount:
        toCents(mpPayment.transaction_details?.net_received_amount) != null
          ? centsToString(toCents(mpPayment.transaction_details.net_received_amount))
          : null,
    });

    if (mpPayment.status === 'approved') {
      const postEnvelope = [];
      await sequelize.transaction(async (t) => {
        const locked = await PaymentOrder.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
        await handleApproved(locked, mpPayment, t, postEnvelope);
      });
      await enqueuePendingDeliveriesAfterCommit(postEnvelope);

      const warmed = await PaymentOrder.findByPk(order.id, { paranoid: true });
      await maybeNotifyLeadFsmAfterMpApproved(warmed, `${mpPayment.status || ''}`);
    }
  } catch (err) {
    // F-16: a ordem não fica órfã em PENDING; vira FAILED (ou PROCESSING se o MP já criou o pagamento).
    await markOrderAfterCheckoutError(order, err);
    throw err;
  }

  const fresh = await PaymentOrder.findByPk(order.id, { paranoid: true });

  return {
    payment_order_id: fresh.id,
    external_reference: externalReference,
    mp_payment_id: String(mpPayment.id),
    pix: {
      qr_code:
        mpPayment.point_of_interaction?.transaction_data?.qr_code || fresh.pix_qr_code || null,
      qr_code_base64:
        mpPayment.point_of_interaction?.transaction_data?.qr_code_base64 ||
        fresh.pix_qr_code_base64 ||
        null,
      expires_at: fresh.pix_expires_at || mpPayment.date_of_expiration || null,
    },
  };
}

async function maybeNotifyLeadFsmAfterMpApproved(orderRow /* Model */, mpStatusNormalized) {
  if (`${mpStatusNormalized || ''}`.toLowerCase().trim() !== 'approved') return;
  try {
    const pid = `${orderRow?.id || ''}`.trim();
    if (!pid) return;
    const row = await PaymentOrder.findByPk(pid, { paranoid: true });
    if (!row) return;

    const ctx = row.checkout_context || {};
    const accountRaw = `${ctx.chatwoot_account_id || process.env.CHATWOOT_ACCOUNT_ID || ''}`.trim();
    const convRaw = `${ctx.chatwoot_conversation_id || ''}`.trim();
    const isFsmLead = Boolean(ctx.lead_fsm_v1) && !!row.lead_id;
    if (!(isFsmLead && accountRaw && convRaw)) return;

    const fmt =
      `${ctx.amount_display_fsm || ''}`.trim() ||
      formatFsmBrlLabel(row.amount ?? row.mp_transaction_amount) ||
      '';

    /** Lazy require para evitar ciclo com `chatwoot.workflow.js`. */
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const wf = require('../chatwoot/chatwoot.workflow');
    await wf.advancePaymentCaptured(accountRaw, convRaw, { amountFormatted: fmt || undefined });
  } catch (e) {
    console.warn('[payments:lead_fsm_mp_hook]', e.message || e);
  }
}

module.exports = {
  formatFsmBrlLabel,
  reconcileLeadFsmPaymentsAfterConversion,
  createPixCheckoutForLeadFsm,
  maybeNotifyLeadFsmAfterMpApproved,
};
