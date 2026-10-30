'use strict';

/**
 * Motor económico da sessão: contas de razão técnicas, split de comissão
 * (tarólogo × plataforma), liquidação pós-COMPLETED (carteira e PACOTE escrow)
 * e reembolso de piso mínimo. Todo movimento monetário é idempotente por chave.
 */
const { Op } = require('sequelize');
const {
  Session,
  Specialist,
  LedgerAccount,
  TransactionLedger,
  ClientCreditLot,
} = require('../../models');
const { sequelize } = require('../../config/database');
const AppError = require('../../utils/AppError');
const businessRules = require('../../config/business.config');
const { ensureClientPacoteEscrow } = require('../../utils/ledgerAccounts.util');
const { roundMoneySes } = require('./sessions.shared');
const CHRONO = require('./session.constants');

/** @param {import('sequelize').Transaction} t */
async function ensurePlatformSuspenseLedger(t) {
  let acc = await LedgerAccount.findOne({
    where: {
      account_type: 'PLATFORM_SUSPENSE',
      client_id: { [Op.is]: null },
      specialist_id: { [Op.is]: null },
    },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        account_type: 'PLATFORM_SUSPENSE',
        currency: 'BRL',
        label: 'Suspense — liquidação gateways',
        cached_balance: null,
      },
      { transaction: t }
    );
  }
  return acc;
}

/** @param {string} clientId */
async function ensureClientWalletLedger(clientId, t) {
  let acc = await LedgerAccount.findOne({
    where: { client_id: clientId, account_type: 'CLIENT_WALLET' },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        client_id: clientId,
        account_type: 'CLIENT_WALLET',
        currency: 'BRL',
        label: 'Carteira',
        cached_balance: 0,
      },
      { transaction: t }
    );
  }
  return acc;
}

async function ensurePlatformRevenueLedger(t) {
  let acc = await LedgerAccount.findOne({
    where: {
      account_type: 'PLATFORM_REVENUE',
      client_id: { [Op.is]: null },
      specialist_id: { [Op.is]: null },
    },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        account_type: 'PLATFORM_REVENUE',
        currency: 'BRL',
        label: 'Receita líquida plataforma (margem pós‑consulta)',
        cached_balance: 0,
      },
      { transaction: t }
    );
  }
  return acc;
}

async function ensureSpecialistEarningsLedger(specialistRowId, t) {
  const sp = `${specialistRowId || ''}`.trim();
  if (!sp) throw new AppError('specialist_id ausente no settle económico.', 500, null, false);

  let acc = await LedgerAccount.findOne({
    where: { specialist_id: sp, account_type: 'SPECIALIST_EARNINGS' },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        specialist_id: sp,
        account_type: 'SPECIALIST_EARNINGS',
        currency: 'BRL',
        label: `Ganhos tarólogo ${sp.slice(0, 8)}…`,
        cached_balance: 0,
      },
      { transaction: t }
    );
  }
  return acc;
}

/** Parte do consumo devido que o saldo não cobriu (0 quando coberto). Rastro apenas, sem cobrança retroativa. */
function uncollectedOf(goal, absorbed) {
  const d = roundMoneySes((Number(goal) || 0) - (Number(absorbed) || 0));
  return d != null && d > 0 ? d : 0;
}

function cachedNum(acc) {
  const n = Number(acc?.cached_balance);
  return Number.isFinite(n) ? n : 0;
}

async function resolveSessionCommissionPctRawLocked(session, t) {
  let pctRaw = Number.parseFloat(`${session.specialist_commission_pct_snapshot ?? ''}`);
  if (!Number.isFinite(pctRaw) || pctRaw < 0) {
    const specLookup = await Specialist.findByPk(session.specialist_id, {
      paranoid: true,
      attributes: ['commission_percent_default'],
      transaction: t,
    });
    const fb = Number.parseFloat(`${specLookup?.commission_percent_default ?? CHRONO.DEFAULT_SPECIALIST_COMMISSION_PCT}`);
    pctRaw = Number.isFinite(fb) && fb >= 0 ? fb : CHRONO.DEFAULT_SPECIALIST_COMMISSION_PCT;
  }
  if (pctRaw > 100) {
    console.error('[sessions:economics] comissão > 100% no snapshot; perna da tarólogo ficará zerada', {
      session_id: session.id,
      pct: pctRaw,
    });
  }
  return pctRaw;
}

async function runCommissionSplitsFromSuspenseLocked(t, sid, session, suspense, absorb) {
  const pctRaw = await resolveSessionCommissionPctRawLocked(session, t);

  let specialistAmt = roundMoneySes((absorb * pctRaw) / 100) ?? 0;
  if (!(specialistAmt >= 0) || specialistAmt > absorb) specialistAmt = 0;
  let platformAmt = roundMoneySes(absorb - specialistAmt);
  platformAmt =
    typeof platformAmt === 'number' && Number.isFinite(platformAmt) ? Math.max(0, platformAmt) : 0;

  const specialistEarn = await ensureSpecialistEarningsLedger(session.specialist_id, t);
  const platRev = await ensurePlatformRevenueLedger(t);

  const idSpec = `commission-specialist-split-${sid}`;
  const existsSpec = await TransactionLedger.findOne({ where: { idempotency_key: idSpec }, transaction: t });

  const occurredAt = session.ended_at || new Date();

  /** Suspense é conta de passagem: sem limitador por cache (antes uma deriva pulava a perna sem erro). */
  if (!existsSpec && specialistAmt > 0) {
    {
      await TransactionLedger.create(
        {
          debit_account_id: suspense.id,
          credit_account_id: specialistEarn.id,
          amount: specialistAmt,
          reference_type: 'COMMISSION_SPLIT',
          reference_id: session.id,
          idempotency_key: idSpec,
          description: `Comissão tarólogo · pct ${pctRaw}% sobre ${absorb}`,
          metadata: { leg: 'specialist', absorb_brl: absorb, pct: pctRaw },
          occurred_at: occurredAt,
        },
        { transaction: t }
      );
      await specialistEarn.reload({ transaction: t, lock: t.LOCK.UPDATE });
      await specialistEarn.update(
        { cached_balance: roundMoneySes(cachedNum(specialistEarn) + specialistAmt) },
        { transaction: t }
      );
      await suspense.reload({ transaction: t, lock: t.LOCK.UPDATE });
      await suspense.update({ cached_balance: roundMoneySes(cachedNum(suspense) - specialistAmt) }, { transaction: t });
    }
  }

  const idPlat = `commission-platform-split-${sid}`;
  const existsPlat = await TransactionLedger.findOne({ where: { idempotency_key: idPlat }, transaction: t });

  if (!existsPlat && platformAmt > 0) {
    const payout = platformAmt;
    if (payout > 0) {
      await TransactionLedger.create(
        {
          debit_account_id: suspense.id,
          credit_account_id: platRev.id,
          amount: payout,
          reference_type: 'COMMISSION_SPLIT',
          reference_id: session.id,
          idempotency_key: idPlat,
          description: `Margem líquida plataforma sobre consulta (${absorb})`,
          metadata: { leg: 'platform_margin', absorb_brl: absorb, specialist_brl: specialistAmt },
          occurred_at: occurredAt,
        },
        { transaction: t }
      );
      await platRev.reload({ transaction: t, lock: t.LOCK.UPDATE });
      await platRev.update(
        {
          cached_balance: roundMoneySes(cachedNum(platRev) + payout),
        },
        { transaction: t }
      );
      await suspense.reload({ transaction: t, lock: t.LOCK.UPDATE });
      await suspense.update({ cached_balance: roundMoneySes(cachedNum(suspense) - payout) }, { transaction: t });
    }
  }

  return { pctRaw, specialistAmt, platformAmt };
}

/**
 * Liquida PACOTE sessão única: absorve até `totalGoal` desde `CLIENT_PACOTE_ESCROW`, queima remanescente,
 * fecha lote (`remaining = 0`, `consumed_at`) e aplica splits sobre o valor absorvido.
 */
async function finalizePacoteSessionEconomicsInTx(t, session, sid, paidM, totalGoalRounded) {
  const suspense = await ensurePlatformSuspenseLedger(t);
  await suspense.reload({ transaction: t, lock: t.LOCK.UPDATE });

  let lotRow = await ClientCreditLot.findByPk(session.consumption_credit_lot_id, {
    transaction: t,
    lock: t.LOCK.UPDATE,
    paranoid: true,
  });

  if (!lotRow) {
    console.warn('[sessions:economics] pacote sem lote ligado — fecho best-effort', { session_id: sid });
    await session.update(
      {
        economics_settled_at: new Date(),
        total_cost: 0,
        economics_uncollected_amount: uncollectedOf(totalGoalRounded, 0),
        specialist_commission_amount_snapshot: 0,
        platform_fee_amount_snapshot: 0,
      },
      { transaction: t }
    );
    return;
  }

  let opening = Number.parseFloat(`${session.pacote_opening_remaining_snapshot ?? ''}`);
  if (!(Number.isFinite(opening) && opening > 0)) {
    opening = Number.parseFloat(`${lotRow.remaining_amount ?? ''}`);
  }
  const openingR =
    Number.isFinite(opening) && opening > 0 ? roundMoneySes(opening) ?? opening : 0;

  const escrowAcc = await ensureClientPacoteEscrow(session.client_id, t);
  await escrowAcc.reload({ transaction: t, lock: t.LOCK.UPDATE });
  const escAvail = cachedNum(escrowAcc);
  const withdrawTotal = openingR > 0 ? Math.min(openingR, escAvail) : 0;

  if (!(withdrawTotal > 0)) {
    console.warn('[sessions:economics] conta pacote sem liquidez alinhada ao snapshot', {
      session_id: sid,
      opening_r: openingR,
      escrow: escAvail,
    });
  }

  const goalNum = Number.isFinite(totalGoalRounded) && totalGoalRounded > 0 ? totalGoalRounded : 0;
  const absorb = Math.min(goalNum, withdrawTotal);
  let leftover = roundMoneySes(withdrawTotal - absorb);
  leftover =
    leftover != null && Number.isFinite(leftover) ? Math.max(0, leftover) : Math.max(0, withdrawTotal - absorb);

  const idPacConsume = `sess-revenue-from-pacote-escrow-${sid}`;
  const existsConsume = await TransactionLedger.findOne({
    where: { idempotency_key: idPacConsume },
    transaction: t,
  });
  const shouldConsume = absorb > 0 && !existsConsume;
  if (shouldConsume) {
    await TransactionLedger.create(
      {
        debit_account_id: escrowAcc.id,
        credit_account_id: suspense.id,
        amount: absorb,
        reference_type: 'SESSION_CONSUMPTION',
        reference_id: session.id,
        idempotency_key: idPacConsume,
        description: `Consumo PACOTE SESSION (${paidM} min pagos; absorb ${absorb} BRL)`,
        metadata: {
          absorb_brl: absorb,
          paid_minutes_floor: paidM,
          billing_track: 'PACOTE_SESSAO_UNICA',
        },
        occurred_at: session.ended_at || new Date(),
      },
      { transaction: t }
    );

    await escrowAcc.reload({ transaction: t, lock: t.LOCK.UPDATE });
    const eMidAbs = cachedNum(escrowAcc);
    await escrowAcc.update(
      {
        cached_balance: roundMoneySes(Math.max(0, eMidAbs - absorb)),
      },
      { transaction: t }
    );

    await suspense.reload({ transaction: t, lock: t.LOCK.UPDATE });
    const sGrowAbs = cachedNum(suspense);
    await suspense.update({ cached_balance: roundMoneySes(sGrowAbs + absorb) }, { transaction: t });
  }

  const platRevForExpiry = await ensurePlatformRevenueLedger(t);
  const idExpiry = `sess-pacote-residual-burn-${sid}`;
  const existsExpiry = await TransactionLedger.findOne({
    where: { idempotency_key: idExpiry },
    transaction: t,
  });
  if (leftover > 0 && !existsExpiry) {
    await TransactionLedger.create(
      {
        debit_account_id: escrowAcc.id,
        credit_account_id: platRevForExpiry.id,
        amount: leftover,
        reference_type: 'CREDIT_EXPIRY',
        reference_id: session.id,
        idempotency_key: idExpiry,
        description: `Remanescente pacote queimado pós-consulta (sessão ${session.id})`,
        metadata: { billing_track: 'PACOTE_SESSAO_UNICA' },
        occurred_at: new Date(),
      },
      { transaction: t }
    );

    await escrowAcc.reload({ transaction: t, lock: t.LOCK.UPDATE });
    await platRevForExpiry.reload({ transaction: t, lock: t.LOCK.UPDATE });
    const eAfter = cachedNum(escrowAcc);
    const pGrow = cachedNum(platRevForExpiry);
    await escrowAcc.update(
      {
        cached_balance: roundMoneySes(Math.max(0, eAfter - leftover)),
      },
      { transaction: t }
    );
    await platRevForExpiry.update(
      {
        cached_balance: roundMoneySes(pGrow + leftover),
      },
      { transaction: t }
    );
  }

  let pctSplit;
  if (absorb > 0) {
    await suspense.reload({ transaction: t, lock: t.LOCK.UPDATE });
    pctSplit = await runCommissionSplitsFromSuspenseLocked(t, sid, session, suspense, absorb);
  } else {
    pctSplit = {
      pctRaw: await resolveSessionCommissionPctRawLocked(session, t),
      specialistAmt: 0,
      platformAmt: 0,
    };
  }

  await lotRow.reload({ transaction: t, lock: t.LOCK.UPDATE });
  await lotRow.update(
    {
      remaining_amount: 0,
      consumed_at: new Date(),
      binding_session_id: null,
      pacote_closure_session_id: session.id,
    },
    { transaction: t }
  );

  await session.update(
    {
      total_cost: absorb,
      economics_uncollected_amount: uncollectedOf(goalNum, absorb),
      specialist_commission_pct_snapshot: pctSplit.pctRaw,
      specialist_commission_amount_snapshot: pctSplit.specialistAmt,
      platform_fee_amount_snapshot: pctSplit.platformAmt,
      economics_settled_at: new Date(),
      consumption_credit_lot_id: null,
      pacote_opening_remaining_snapshot: null,
      billing_track: null,
    },
    { transaction: t }
  );
}

/** Fecho financeiro idempotente quando `telecom_status` passa a COMPLETED. Carteira tarólogo = SPECIALIST_EARNINGS. */
async function finalizeSessionEconomicsAfterTelecomCompletion(sessionId) {
  const sid = `${sessionId || ''}`.trim();
  if (!sid) return;

  await sequelize.transaction(async (t) => {
    const session = await Session.findByPk(sid, { paranoid: true, transaction: t, lock: t.LOCK.UPDATE });
    if (!session) return;
    if (`${session.telecom_status || ''}`.toUpperCase() !== 'COMPLETED') return;
    if (session.economics_settled_at) return;

    const paidM = Math.max(0, Math.floor(Number(session.paid_minutes_used ?? 0)));
    const minutePrice = Number.parseFloat(`${session.minute_price_applied_snapshot ?? ''}`);
    let totalGoal = Number.parseFloat(`${session.total_cost ?? ''}`);

    if (
      (!Number.isFinite(totalGoal) || totalGoal <= 0) &&
      paidM > 0 &&
      Number.isFinite(minutePrice) &&
      minutePrice > 0
    ) {
      totalGoal = roundMoneySes(paidM * minutePrice) ?? 0;
    }

    const totalGoalRounded =
      Number.isFinite(totalGoal) && totalGoal > 0 ? roundMoneySes(totalGoal) ?? totalGoal : 0;

    const trackRaw = `${session.billing_track || 'CLIENT_WALLET'}`.trim().toUpperCase();
    const isPacoteTrack =
      trackRaw === 'PACOTE_SESSAO_UNICA' && `${session.consumption_credit_lot_id || ''}`.trim();

    if (isPacoteTrack) {
      await finalizePacoteSessionEconomicsInTx(t, session, sid, paidM, totalGoalRounded);
      return;
    }

    if (!(totalGoalRounded > 0)) {
      await session.update(
        {
          total_cost: 0,
          specialist_commission_amount_snapshot: 0,
          platform_fee_amount_snapshot: 0,
          economics_settled_at: new Date(),
        },
        { transaction: t }
      );
      return;
    }

    const wallet = await ensureClientWalletLedger(session.client_id, t);
    await wallet.reload({ transaction: t, lock: t.LOCK.UPDATE });
    const suspense = await ensurePlatformSuspenseLedger(t);
    await suspense.reload({ transaction: t, lock: t.LOCK.UPDATE });

    const wBal = cachedNum(wallet);
    const absorb = Math.min(totalGoalRounded, Math.max(0, roundMoneySes(wBal) ?? wBal));

    if (!(absorb > 0)) {
      console.error('[sessions:economics] consumo SEM cobertura de saldo (registrado em economics_uncollected_amount)', {
        session_id: sid,
        goal: totalGoalRounded,
      });
      await session.update(
        {
          total_cost: totalGoalRounded,
          economics_uncollected_amount: totalGoalRounded,
          specialist_commission_amount_snapshot: 0,
          platform_fee_amount_snapshot: 0,
          economics_settled_at: new Date(),
        },
        { transaction: t }
      );
      return;
    }

    const idConsume = `sess-revenue-to-suspense-${sid}`;
    const consumedLedger = await TransactionLedger.findOne({ where: { idempotency_key: idConsume }, transaction: t });

    if (!consumedLedger) {
      await TransactionLedger.create(
        {
          debit_account_id: wallet.id,
          credit_account_id: suspense.id,
          amount: absorb,
          reference_type: 'SESSION_CONSUMPTION',
          reference_id: session.id,
          idempotency_key: idConsume,
          description: `Consumo sessão (${paidM} min pagos efectivos; absorb ${absorb} BRL)`,
          metadata: {
            absorb_brl: absorb,
            paid_minutes_floor: paidM,
          },
          occurred_at: session.ended_at || new Date(),
        },
        { transaction: t }
      );
      await wallet.update({ cached_balance: roundMoneySes(wBal - absorb) }, { transaction: t });

      await suspense.reload({ transaction: t, lock: t.LOCK.UPDATE });
      const sBalBefore = cachedNum(suspense);
      await suspense.update({ cached_balance: roundMoneySes(sBalBefore + absorb) }, { transaction: t });
    }

    const { pctRaw, specialistAmt, platformAmt } = await runCommissionSplitsFromSuspenseLocked(
      t,
      sid,
      session,
      suspense,
      absorb
    );

    await session.update(
      {
        total_cost: absorb,
        economics_uncollected_amount: uncollectedOf(totalGoalRounded, absorb),
        specialist_commission_pct_snapshot: pctRaw,
        specialist_commission_amount_snapshot: specialistAmt,
        platform_fee_amount_snapshot: platformAmt,
        economics_settled_at: new Date(),
      },
      { transaction: t }
    );
  });
}

/**
 * Motor “piso mínimo” (~15 min económicos): créditos `FLOOR_COMPENSATION` proporcionais a
 * `MAX(0, floorMinutes − paid_minutes_used_snapshot)` quando a sessão termina elegível (`business.config`).
 *
 * Debita `PLATFORM_SUSPENSE` → `CLIENT_WALLET`. Idempotência compartilha o legado `system-floor-session-*`.
 *
 * @param {string} sessionId
 * @param {{ eligibleReasonCodesOverride?: string[] }} [options]
 */
async function applyMinimumFloorReimbursement(sessionId, options = {}) {
  const sid = `${sessionId || ''}`.trim();
  const sessionRow = sid ? await Session.findByPk(sid, { paranoid: true }) : null;

  if (!sessionRow) {
    throw new AppError('Sessão não encontrada.', 404, null, true);
  }

  if (!sessionRow.ended_reason_code || !`${sessionRow.ended_reason_code || ''}`.trim()) {
    throw new AppError(
      'Sessão sem `ended_reason_code` definido — defina antes o motivo antes de aplicar o piso mínimo.',
      409,
      null,
      true
    );
  }

  const endedReasonRaw = `${sessionRow.ended_reason_code || ''}`.trim().toUpperCase();
  const eligibleCodes =
    options.eligibleReasonCodesOverride && Array.isArray(options.eligibleReasonCodesOverride)
      ? options.eligibleReasonCodesOverride
      : businessRules.SESSION_FLOOR_ELIGIBLE_END_REASONS;
  const eligible = new Set(eligibleCodes);
  if (!eligible.has(endedReasonRaw)) {
    throw new AppError(
      `Ajuste de piso só aplica quando ended_reason_code é um dos valores permitidos (${eligibleCodes.join(
        ', '
      )}).`,
      400,
      { ended_reason_code: endedReasonRaw || null },
      true
    );
  }

  const priceMin = Number.parseFloat(`${sessionRow.minute_price_applied_snapshot ?? ''}`);
  if (!Number.isFinite(priceMin) || priceMin <= 0) {
    throw new AppError(
      'minute_price_applied_snapshot em falta ou inválido para esta sessão — não há base para o piso.',
      400,
      null,
      true
    );
  }

  const consumedRaw = Number(sessionRow.paid_minutes_used ?? 0);
  const paidMinutesConsumed =
    Number.isFinite(consumedRaw) && consumedRaw >= 0 ? Math.floor(consumedRaw) : 0;

  const floorMinutes = businessRules.SESSION_MINIMUM_FLOOR_MINUTES;
  const bonusMinutes = Math.max(0, floorMinutes - paidMinutesConsumed);
  const targetCreditEquivalent = roundMoneySes(bonusMinutes * priceMin);

  const idempotencyKey = `floor-compensation-session-${sid}`;
  const legacyIdempotencyKey = `system-floor-session-${sid}`;

  const existing = await TransactionLedger.findOne({
    where: { idempotency_key: { [Op.in]: [idempotencyKey, legacyIdempotencyKey] } },
  });
  if (existing) {
    const bonusPaid = Number(existing.amount);
    return {
      applied: false,
      idempotent_hit: true,
      bonus_added: bonusPaid,
      bonus_minutes: bonusMinutes,
      paid_minutes_consumed: paidMinutesConsumed,
      session_id: sid,
      message: 'Compensação de piso já foi aplicada (idempotência).',
    };
  }

  let bonusAdded = 0;

  /** Sem crédito efetivo: não há movimento económico novo. */
  if (!(targetCreditEquivalent > 0)) {
    return {
      applied: false,
      bonus_added: 0,
      bonus_minutes: bonusMinutes,
      paid_minutes_consumed: paidMinutesConsumed,
      target_credit_equivalent_brl: targetCreditEquivalent,
      floor_minutes_budget: floorMinutes,
      session_id: sid,
      message: `Minutos‑bónus = max(0, ${floorMinutes} − ${paidMinutesConsumed}) ⇒ sem crédito.`,
    };
  }

  await sequelize.transaction(async (t) => {
    await Session.findByPk(sid, { transaction: t, lock: t.LOCK.UPDATE, paranoid: true });

    const wallet = await ensureClientWalletLedger(sessionRow.client_id, t);

    await wallet.reload({ transaction: t, lock: t.LOCK.UPDATE });

    const bal = Number(wallet.cached_balance ?? 0);
    const roundedBonus = roundMoneySes(targetCreditEquivalent);
    bonusAdded = roundedBonus ?? 0;

    if (!roundedBonus || roundedBonus <= 0) {
      return;
    }

    const suspense = await ensurePlatformSuspenseLedger(t);

    await TransactionLedger.create(
      {
        debit_account_id: suspense.id,
        credit_account_id: wallet.id,
        amount: roundedBonus,
        reference_type: 'FLOOR_COMPENSATION',
        reference_id: sessionRow.id,
        idempotency_key: idempotencyKey,
        description: `Piso (${floorMinutes} min): bónus de minutos após uso parcial (${paidMinutesConsumed} min consumidos · sessão ${sessionRow.id})`,
        metadata: {
          minute_price_applied_snapshot: priceMin,
          floor_minutes_budget: floorMinutes,
          ended_reason_code: endedReasonRaw,
          paid_minutes_consumed_snapshot: paidMinutesConsumed,
          bonus_minutes_calc: bonusMinutes,
          formula: `MAX(0, ${floorMinutes} - ${paidMinutesConsumed})`,
          previous_cached_balance_client: bal,
        },
        occurred_at: new Date(),
      },
      { transaction: t }
    );

    const newBal = roundMoneySes(bal + roundedBonus);
    await wallet.update(
      {
        cached_balance: newBal,
      },
      { transaction: t }
    );
  });

  return {
    applied: bonusAdded > 0,
    bonus_added: bonusAdded,
    bonus_minutes: bonusMinutes,
    paid_minutes_consumed: paidMinutesConsumed,
    target_credit_equivalent_brl: targetCreditEquivalent,
    floor_minutes_budget: floorMinutes,
    session_id: sid,
  };
}

module.exports = {
  ensurePlatformSuspenseLedger,
  ensureClientWalletLedger,
  ensurePlatformRevenueLedger,
  ensureSpecialistEarningsLedger,
  cachedNum,
  resolveSessionCommissionPctRawLocked,
  runCommissionSplitsFromSuspenseLocked,
  finalizePacoteSessionEconomicsInTx,
  finalizeSessionEconomicsAfterTelecomCompletion,
  applyMinimumFloorReimbursement,
};
