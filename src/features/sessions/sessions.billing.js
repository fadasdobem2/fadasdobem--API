'use strict';

/**
 * Cronômetro de cobrança (2+X+2): varre sessões ativas, calcula minutos
 * gratuitos/pagos, compara com o saldo comprável (carteira ou pacote), emite
 * WARNING e faz HARD CUT quando o saldo pago se esgota.
 */
const { Op } = require('sequelize');
const { Session, LedgerAccount, ClientCreditLot } = require('../../models');
const { catchAsyncService } = require('../../utils/catchAsync.util');
const CHRONO = require('./session.constants');
const telecomManager = require('./telecom.manager');
const { updateSessionTelecomAndMaybeAdvanceQueue } = require('./sessions.lifecycle');
const { computeBillableMinutes } = require('./sessions.minutes');
const { siblingWalletReservedUnits } = require('./sessions.balance');
const { reconcileUnsettledCompletedSessions } = require('./sessions.reconcile');
const { toUnits } = require('../../utils/moneyUnits.util');

/** Reconciliação do fecho econômico roda no máximo a cada N ms dentro do tick (que já tem lock distribuído). */
const RECONCILE_EVERY_MS = Math.max(Number(process.env.SESSION_RECONCILE_INTERVAL_MS) || 60000, 5000);
let lastReconcileAt = 0;

async function maybeReconcileEconomics() {
  const now = Date.now();
  if (now - lastReconcileAt < RECONCILE_EVERY_MS) return;
  lastReconcileAt = now;
  try {
    await reconcileUnsettledCompletedSessions();
  } catch (err) {
    console.error('[billing:reconcile] falhou:', err?.message || err);
  }
}

async function runBillingTickSweep() {
  const sessions = await Session.findAll({
    where: {
      telecom_status: { [Op.in]: ['ACTIVE', 'WARNING'] },
      started_at: { [Op.ne]: null },
      ended_at: null,
      telecom_provider: { [Op.in]: ['AGORA', 'INTELBRAS', 'WHATSAPP'] },
    },
    paranoid: true,
    limit: 200,
    order: [['updated_at', 'ASC']],
  });

  for (const session of sessions) {
    await processOneBillingSession(session).catch((err) => {
      console.error('[billing:tick]', session.id, err?.message || err);
    });
  }

  await maybeReconcileEconomics();
}

async function processOneBillingSession(session) {
  const live = await Session.findByPk(session.id, { paranoid: true });
  if (!live) return;

  const introFree = Number(CHRONO.FREE_INITIAL_MINUTES) || 0;
  const warnRemain = Number(CHRONO.WARNING_REMAINING_MINUTES) || 0;

  const startedMs = live.started_at ? new Date(live.started_at).getTime() : NaN;
  if (!Number.isFinite(startedMs)) return;

  const { freeUsed, paidUsed } = computeBillableMinutes(live.started_at, Date.now(), introFree);

  const mp = Number.parseFloat(`${live.minute_price_applied_snapshot ?? ''}`);
  if (!Number.isFinite(mp) || mp <= 0) {
    await live.update({
      free_minutes_used: freeUsed,
      paid_minutes_used: paidUsed,
    });
    return;
  }

  const trackRaw = `${live.billing_track || 'CLIENT_WALLET'}`.trim().toUpperCase();
  const isPacoteTrack =
    trackRaw === 'PACOTE_SESSAO_UNICA' && `${live.consumption_credit_lot_id || ''}`.trim();

  let affordablePaidWholeMinutes = 0;

  if (isPacoteTrack) {
    let budgetBrl =
      Number.parseFloat(`${live.pacote_opening_remaining_snapshot ?? ''}`) ||
      NaN;
    if (!Number.isFinite(budgetBrl) || budgetBrl <= 0) {
      const lotRow = `${live.consumption_credit_lot_id || ''}`.trim()
        ? await ClientCreditLot.findByPk(live.consumption_credit_lot_id, {
            paranoid: true,
            attributes: ['remaining_amount'],
          })
        : null;
      if (lotRow) budgetBrl = Number.parseFloat(`${lotRow.remaining_amount ?? ''}`);
    }
    if (!Number.isFinite(budgetBrl) || budgetBrl <= 0) {
      await live.update({
        free_minutes_used: freeUsed,
        paid_minutes_used: paidUsed,
      });
      return;
    }
    affordablePaidWholeMinutes = Math.max(0, Math.floor(budgetBrl / mp));
  } else {
    const wallet = await LedgerAccount.findOne({
      where: { client_id: live.client_id, account_type: 'CLIENT_WALLET' },
      attributes: ['id', 'cached_balance'],
    });
    let bal = Number.parseFloat(`${wallet?.cached_balance ?? ''}`);
    if (Number.isFinite(bal) && live.client_id) {
      /** Saldo só vale o que sobra após o consumo já acumulado pelas outras sessões abertas do cliente. */
      const reservedU = await siblingWalletReservedUnits('client_id', live.client_id, live.id, null);
      bal = (toUnits(bal) - reservedU) / 10000;
    }
    if (!Number.isFinite(bal)) {
      await live.update({
        free_minutes_used: freeUsed,
        paid_minutes_used: paidUsed,
      });
      return;
    }
    affordablePaidWholeMinutes = Math.max(0, Math.floor(bal / mp));
  }

  /** Minutos‑saldo já “queimados” depois da cortesia. */
  const remainingPaidBucket = affordablePaidWholeMinutes - paidUsed;

  if (paidUsed > 0 && remainingPaidBucket <= 0) {
    console.warn('[Agora:Billing] saldo esgotado · hard cut', {
      sessionId: live.id,
      paidUsed,
      freeUsed,
      track: trackRaw || 'CLIENT_WALLET',
      channel:
        `${live.provider_channel_id || live.agora_channel_id || ''}`.trim() || null,
    });
    await telecomManager.disconnectSession(live).catch(() => {});
    await updateSessionTelecomAndMaybeAdvanceQueue(live, {
      telecom_status: 'COMPLETED',
      ended_at: live.ended_at || new Date(),
      ended_reason_code: 'NO_BALANCE_HARD_CUT',
      free_minutes_used: freeUsed,
      paid_minutes_used: paidUsed,
      billing_closed_at: live.billing_closed_at || new Date(),
    });
    return;
  }

  if (
    paidUsed > 0 &&
    remainingPaidBucket > 0 &&
    remainingPaidBucket <= warnRemain &&
    live.telecom_status !== 'WARNING'
  ) {
    console.log('[Agora:Billing] WARNING — minutos pagos restantes baixos', {
      sessionId: live.id,
      remainingPaidBucket,
      paidUsed,
    });
    await live.update({
      telecom_status: 'WARNING',
      free_minutes_used: freeUsed,
      paid_minutes_used: paidUsed,
    });
    return;
  }

  await live.update({
    free_minutes_used: freeUsed,
    paid_minutes_used: paidUsed,
  });
}

const billingTickSweepAsync = catchAsyncService(runBillingTickSweep);

module.exports = {
  runBillingTickSweep,
  processOneBillingSession,
  billingTickSweepAsync,
};
