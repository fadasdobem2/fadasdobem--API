'use strict';

/**
 * Ciclo de vida da sessão: criação (resolução de cliente/preço/UIDs Agora),
 * escolha do trilho de consumo (PACOTE FIFO vs carteira), libertação de vínculo
 * pós-erro e a transição telecom que dispara fila + fecho económico.
 */
const { Op } = require('sequelize');
const { randomUUID } = require('crypto');
const { Session, Specialist, ClientCreditLot, PricingLevel } = require('../../models');
const { sequelize } = require('../../config/database');
const AppError = require('../../utils/AppError');
const businessRules = require('../../config/business.config');
const { resolveClientRow } = require('../../utils/clientRef.util');
const queuesService = require('../queues/queues.service');
const { sessionModalityMatchesPacoteLot } = require('../payments/payments.modalities');
const {
  roundMoneySes,
  pickDistinctAgoraUids,
  mediaPolicyForModality,
  SESSION_CREATE_STATUSES,
  SESSION_MODALITIES_SET,
} = require('./sessions.shared');
const {
  applyMinimumFloorReimbursement,
  finalizeSessionEconomicsAfterTelecomCompletion,
} = require('./sessions.economics');
const CHRONO = require('./session.constants');
const { computeBillableMinutes } = require('./sessions.minutes');
const { lockClientSessions, assertClientCanOpenSession } = require('./sessions.balance');

/**
 * Sessão interrompida (ex.: telecom ERROR antes de COMPLETED): liberta lote PACOTE para nova utilização.
 */
async function releasePacoteLotBindingOnSessionInterrupted(sessionId) {
  const sid = `${sessionId || ''}`.trim();
  if (!sid) return;

  try {
    await sequelize.transaction(async (t) => {
      const s = await Session.findByPk(sid, {
        paranoid: true,
        transaction: t,
        lock: t.LOCK.UPDATE,
        attributes: [
          'id',
          'consumption_credit_lot_id',
          'billing_track',
          'pacote_opening_remaining_snapshot',
        ],
      });
      if (!s || !s.consumption_credit_lot_id) return;

      await ClientCreditLot.update(
        { binding_session_id: null },
        {
          where: { id: s.consumption_credit_lot_id, binding_session_id: sid },
          transaction: t,
        }
      );

      await s.update(
        {
          consumption_credit_lot_id: null,
          billing_track: 'CLIENT_WALLET',
          pacote_opening_remaining_snapshot: null,
        },
        { transaction: t }
      );
    });
  } catch (e) {
    console.warn('[sessions:pacote] falha ao libertar vínculo pós-erro:', sid, e?.message || e);
  }
}

/**
 * Piso 15 min apenas em motivos técnicos configurados (`SESSION_TECH_FLOOR_ELIGIBLE_END_REASONS`)
 * e apenas se minutos pagos efectivos `< SESSION_MINIMUM_FLOOR_MINUTES`.
 */
async function maybeApplyTechnicalFloorStrict(sessionId) {
  const sid = `${sessionId || ''}`.trim();
  const sRow = sid ? await Session.findByPk(sid, { paranoid: true }) : null;
  if (!sRow?.ended_reason_code) return;

  const reason = `${sRow.ended_reason_code}`.trim().toUpperCase();
  const tech = new Set(businessRules.SESSION_TECH_FLOOR_ELIGIBLE_END_REASONS);
  if (!tech.has(reason)) return;

  const paidRaw = Number(sRow.paid_minutes_used ?? 0);
  const paidM = Number.isFinite(paidRaw) && paidRaw >= 0 ? Math.floor(paidRaw) : 0;
  if (!(paidM < businessRules.SESSION_MINIMUM_FLOOR_MINUTES)) return;

  try {
    await applyMinimumFloorReimbursement(sid, {
      eligibleReasonCodesOverride: [...tech],
    });
  } catch (e) {
    console.warn('[sessions:floor.tech] aplicar piso — ignorado/não aplicável:', sid, e?.message || e);
  }
}

/**
 * Decide trilho de consumo ao criar sessão: primeiro pacote válido (FIFO `SKIP LOCKED`) ou carteira avulsa.
 */
async function bindConsumptionTrackToSessionRow(sessionId) {
  const sid = `${sessionId || ''}`.trim();
  if (!sid) return;

  await sequelize.transaction(async (t) => {
    const sess = await Session.findByPk(sid, {
      paranoid: true,
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!sess) return;

    const modality = `${sess.modality || ''}`.trim().toUpperCase();

    const lot = await ClientCreditLot.findOne({
      where: {
        client_id: sess.client_id,
        credit_type: 'PACOTE_SESSAO_UNICA',
        consumed_at: { [Op.is]: null },
        binding_session_id: { [Op.is]: null },
        is_locked: false,
        remaining_amount: { [Op.gt]: 0 },
      },
      order: [['created_at', 'ASC']],
      transaction: t,
      lock: t.LOCK.UPDATE,
      skipLocked: true,
    });

    let chosen =
      lot && sessionModalityMatchesPacoteLot(modality, lot.consumption_modalities) ? lot : null;

    if (chosen?.id) {
      const conflicting = await Session.findOne({
        where: {
          consumption_credit_lot_id: chosen.id,
          id: { [Op.ne]: sid },
          telecom_status: { [Op.in]: ['PENDING', 'ACTIVE', 'WARNING'] },
          ended_at: { [Op.is]: null },
        },
        transaction: t,
        paranoid: true,
      });
      if (conflicting) chosen = null;
    }

    if (chosen?.id) {
      const openingRaw = Number.parseFloat(`${chosen.remaining_amount}`);
      const openingRounded = roundMoneySes(openingRaw);
      await chosen.update({ binding_session_id: sess.id }, { transaction: t });
      await sess.update(
        {
          billing_track: 'PACOTE_SESSAO_UNICA',
          consumption_credit_lot_id: chosen.id,
          pacote_opening_remaining_snapshot:
            openingRounded ?? (Number.isFinite(openingRaw) && openingRaw > 0 ? openingRaw : null),
        },
        { transaction: t }
      );
      return;
    }

    await sess.update(
      {
        billing_track: 'CLIENT_WALLET',
        consumption_credit_lot_id: null,
        pacote_opening_remaining_snapshot: null,
      },
      { transaction: t }
    );
  });
}

/**
 * Fecho econômico com poucas retentativas em memória; se esgotarem (ou o processo cair), a reconciliação
 * (`sessions.reconcile.js`, chamada pelo tick de cobrança) refaz o fecho: ele é idempotente.
 */
async function finalizeEconomicsWithRetry(sessionId, attempts = 3) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await finalizeSessionEconomicsAfterTelecomCompletion(sessionId);
      return true;
    } catch (e) {
      lastErr = e;
      console.error('[sessions:economics] falha no fecho (tentativa %d/%d):', i, attempts, sessionId, e?.message || e);
      if (i < attempts) await new Promise((r) => setTimeout(r, 500 * i * i));
    }
  }
  console.error('[sessions:economics] fecho adiado para a reconciliação:', sessionId, lastErr?.message || lastErr);
  return false;
}

/**
 * Antes do fecho, recalcula os minutos pelo relógio do servidor (`started_at`/`ended_at`), pois o último
 * tick pode estar até ~1 min atrasado. Mesma regra do tick (piso por minuto cheio); só aumenta.
 */
async function refreshBillableMinutesAtClose(sessionId) {
  const s = await Session.findByPk(sessionId, { paranoid: true });
  if (!s || s.economics_settled_at || !s.started_at || !s.ended_at) return;
  const { freeUsed, paidUsed } = computeBillableMinutes(s.started_at, s.ended_at, CHRONO.FREE_INITIAL_MINUTES);
  const curPaid = Math.max(0, Math.floor(Number(s.paid_minutes_used ?? 0)));
  const curFree = Math.max(0, Math.floor(Number(s.free_minutes_used ?? 0)));
  if (paidUsed > curPaid || freeUsed > curFree) {
    await s.update({
      paid_minutes_used: Math.max(curPaid, paidUsed),
      free_minutes_used: Math.max(curFree, freeUsed),
    });
  }
}

/**
 * Quando telecom passa a `COMPLETED`, convida o primeiro `WAITING` e dispara sockets.
 * Só corre se o estado anterior **não** era `COMPLETED` (evita duplicar promoção no mesmo ciclo da sessão).
 */
async function updateSessionTelecomAndMaybeAdvanceQueue(sessionEntity, attrs) {
  const prevTc = `${sessionEntity.telecom_status || ''}`.toUpperCase();
  await sessionEntity.update(attrs);
  await sessionEntity.reload({ paranoid: true });

  const nextTc = `${sessionEntity.telecom_status || ''}`.toUpperCase();

  if (prevTc !== 'ERROR' && nextTc === 'ERROR') {
    await releasePacoteLotBindingOnSessionInterrupted(sessionEntity.id);
  }

  if (prevTc !== 'COMPLETED' && nextTc === 'COMPLETED' && sessionEntity.specialist_id) {
    try {
      await refreshBillableMinutesAtClose(sessionEntity.id);
      await sessionEntity.reload({ paranoid: true });
    } catch (e) {
      console.error('[sessions:minutes] recálculo no encerramento falhou:', sessionEntity.id, e?.message || e);
    }
    try {
      await maybeApplyTechnicalFloorStrict(sessionEntity.id);
    } catch (e) {
      console.warn('[sessions:floor] pré-finalize erro transiente:', sessionEntity.id, e?.message || e);
    }
    finalizeEconomicsWithRetry(sessionEntity.id).catch((e) =>
      console.error('[sessions:economics] falha finalize pós‑COMPLETED:', sessionEntity.id, e?.message || e)
    );
    queuesService
      .promoteFirstWaitingAfterSessionEnded(sessionEntity.specialist_id, {
        session_id: sessionEntity.id,
      })
      .catch((err) =>
        console.error(
          '[Queue] avançar fila pós-COMPLETED falhou:',
          sessionEntity?.id,
          err?.message || err
        )
      );
  }
}

/**
 * POST /sessions — cliente autenticado abre sessão (VIDEO default = WideVoice/Intelbras; legacy Agora via env).
 * `client_id` na BD é o UUID de `clients`, resolvido pelo `User` autenticado (não confundir com `users.id`).
 */
async function createSession(authenticatedUser, body = {}) {
  const specialistId = `${body.specialist_id ?? body.specialistId ?? ''}`.trim();
  const modality = `${body.modality ?? ''}`.trim().toUpperCase();
  const statusRaw = `${body.status ?? ''}`.trim().toUpperCase();
  const lifecycleStatus =
    statusRaw && SESSION_CREATE_STATUSES.includes(statusRaw) ? statusRaw : 'READY';

  if (!specialistId) {
    throw new AppError('specialist_id é obrigatório.', 400, null, true);
  }
  if (!SESSION_MODALITIES_SET.has(modality)) {
    throw new AppError('modality inválida. Use TEXTO, VOZ ou VIDEO.', 400, null, true);
  }

  const { row: clientRow, column: clientColumn } = await resolveClientRow(authenticatedUser, {
    include: [{ model: PricingLevel, as: 'pricing_level', required: true }],
    attributes: ['id', 'pricing_level_id', 'manual_price_override'],
  });
  if (!clientRow || !clientRow.pricing_level) {
    throw new AppError('Cliente sem nível de preço válido (`pricing_level_id`). Configure na Gestão.', 400, null, true);
  }

  const specialist = await Specialist.findByPk(specialistId, {
    paranoid: true,
    attributes: ['id', 'user_id', 'commission_percent_default'],
  });
  if (!specialist) {
    throw new AppError('Especialista não encontrada.', 404, null, true);
  }
  if (specialist.user_id === authenticatedUser.id) {
    throw new AppError('Não é possível agendar sessão consigo mesma como especialista.', 400, null, true);
  }

  const correlationChannel = randomUUID();
  const isVideo = modality === 'VIDEO';
  const isVoice = modality === 'VOZ';
  /** VOZ e VIDEO usam Agora.io; TEXTO continua sem motor de tempo real. */
  const useAgoraRtc = Boolean(isVideo || isVoice);
  const { clientUid, specialistUid } = useAgoraRtc
    ? pickDistinctAgoraUids()
    : { clientUid: null, specialistUid: null };

  const pl = clientRow.pricing_level;
  const minutePriceRaw =
    modality === 'VIDEO' ? Number.parseFloat(`${pl.price_video}`) : Number.parseFloat(`${pl.price_text_voice}`);
  if (!Number.isFinite(minutePriceRaw) || minutePriceRaw <= 0) {
    throw new AppError('Preço‑minuto do nível de precificação inválido.', 500, null, false);
  }
  const pctRaw = specialist.commission_percent_default != null
    ? Number.parseFloat(`${specialist.commission_percent_default}`)
    : CHRONO.DEFAULT_SPECIALIST_COMMISSION_PCT;
  if (!Number.isFinite(pctRaw) || pctRaw < 0 || pctRaw > 100) {
    throw new AppError('Comissão da especialista fora da faixa 0 a 100 (`commission_percent_default`).', 500, null, false);
  }
  const pctSnapshot = pctRaw;

  /** Saldo mínimo + reserva entre sessões do mesmo cliente: checagem e criação sob o mesmo lock. */
  const session = await sequelize.transaction(async (t) => {
    await lockClientSessions(`${clientColumn}:${clientRow.id}`, t);
    await assertClientCanOpenSession(
      { clientColumn, clientId: clientRow.id, minutePrice: minutePriceRaw, modality },
      t
    );
    return Session.create({
      [clientColumn]: clientRow.id,
      specialist_id: specialistId,
      modality,
      status: lifecycleStatus,
      telecom_provider: useAgoraRtc ? 'AGORA' : null,
      provider_channel_id: correlationChannel,
      agora_channel_id: useAgoraRtc ? correlationChannel : null,
      agora_uid_client: useAgoraRtc ? clientUid : null,
      agora_uid_specialist: useAgoraRtc ? specialistUid : null,
      telecom_status: 'PENDING',
      minute_price_applied_snapshot: roundMoneySes(minutePriceRaw),
      specialist_commission_pct_snapshot: roundMoneySes(pctSnapshot),
      pricing_level_id_snapshot: pl.id ?? clientRow.pricing_level_id ?? null,
      manual_price_override_snapshot: Boolean(clientRow.manual_price_override),
    }, { transaction: t });
  });

  await bindConsumptionTrackToSessionRow(session.id);

  console.log('[Sessions] criada', {
    id: session.id,
    provider_channel_id: correlationChannel,
    modality,
    telecom_provider: useAgoraRtc ? 'AGORA' : null,
    media_policy: mediaPolicyForModality(modality),
  });

  const hydrated = await Session.findByPk(session.id, { paranoid: true });
  return hydrated ? hydrated.get({ plain: true }) : session.get({ plain: true });
}

module.exports = {
  releasePacoteLotBindingOnSessionInterrupted,
  maybeApplyTechnicalFloorStrict,
  bindConsumptionTrackToSessionRow,
  updateSessionTelecomAndMaybeAdvanceQueue,
  finalizeEconomicsWithRetry,
  refreshBillableMinutesAtClose,
  createSession,
};
