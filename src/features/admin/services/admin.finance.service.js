'use strict';

const { Op } = require('sequelize');
const {
  sequelize,
  Specialist,
  LedgerAccount,
  TransactionLedger,
  Client,
  PayoutRequest,
  PaymentOrder,
} = require('../../../models');
const AppError = require('../../../utils/AppError');
const { persistAdminAuditLog } = require('../helpers/adminAudit.helper');
const { assertTransition, lockSpecialistFinance, postPayoutDebit } = require('../../payouts/payouts.state');
const { serializePayout } = require('../../payouts/payouts.service');

const ACCOUNT_LEDGER_INCLUDES = [
  {
    model: LedgerAccount,
    as: 'debit_account',
    attributes: ['id', 'account_type', 'client_id', 'specialist_id', 'label', 'cached_balance'],
    required: false,
    include: [
      { model: Client, as: 'client', attributes: ['id', 'nome_id', 'nome_completo', 'nome'], required: false },
      {
        model: Specialist,
        as: 'specialist',
        attributes: ['id', 'display_name'],
        required: false,
      },
    ],
  },
  {
    model: LedgerAccount,
    as: 'credit_account',
    attributes: ['id', 'account_type', 'client_id', 'specialist_id', 'label', 'cached_balance'],
    required: false,
    include: [
      { model: Client, as: 'client', attributes: ['id', 'nome_id', 'nome_completo', 'nome'], required: false },
      {
        model: Specialist,
        as: 'specialist',
        attributes: ['id', 'display_name'],
        required: false,
      },
    ],
  },
];

function coerceParty(acc) {
  if (!acc) return null;
  const c = acc.client;
  const s = acc.specialist;
  return {
    ledger_account_id: acc.id,
    account_type: acc.account_type,
    label: acc.label || null,
    client_id: acc.client_id || null,
    specialist_id: acc.specialist_id || null,
    cached_balance: acc.cached_balance != null ? Number(acc.cached_balance) : null,
    client_nome_visible: c ? c.nome_id || c.nome_completo || c.nome || null : null,
    specialist_display_name: s ? s.display_name || null : null,
  };
}

function serializeLedgerMovement(row) {
  const j = typeof row?.toJSON === 'function' ? row.toJSON() : row;
  return {
    id: j.id,
    occurred_at: j.occurred_at,
    created_at: j.created_at,
    reference_type: j.reference_type,
    reference_id: j.reference_id || null,
    idempotency_key: j.idempotency_key || null,
    description: j.description || null,
    amount: j.amount != null ? Number(j.amount) : null,
    metadata: j.metadata || null,
    debit: coerceParty(j.debit_account),
    credit: coerceParty(j.credit_account),
    created_by_user_id: j.created_by_user_id || null,
  };
}

async function listFinanceLedgerTransactions(query = {}) {
  let limit = parseInt(`${query.limit ?? 50}`, 10);
  if (!Number.isFinite(limit)) limit = 50;
  limit = Math.min(Math.max(limit, 1), 200);

  let offset = parseInt(`${query.offset ?? 0}`, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  /** @type {import('sequelize').WhereOptions} */
  const where = {};

  const rtRaw = `${query.reference_type || ''}`.trim();
  if (rtRaw && Array.isArray(TransactionLedger.REF_TYPES) && TransactionLedger.REF_TYPES.includes(rtRaw)) {
    where.reference_type = rtRaw;
  }

  const fromIso = `${query.occurred_from || query.from || ''}`.trim();
  const toIso = `${query.occurred_to || query.to || ''}`.trim();

  const fromDt = fromIso ? new Date(fromIso) : null;
  const toDt = toIso ? new Date(toIso) : null;

  if (fromDt && Number.isFinite(fromDt.getTime())) {
    where.occurred_at = { ...(where.occurred_at || {}), [Op.gte]: fromDt };
  }
  if (toDt && Number.isFinite(toDt.getTime())) {
    where.occurred_at = { ...(where.occurred_at || {}), [Op.lte]: toDt };
  }

  const [total, rows] = await Promise.all([
    TransactionLedger.count({ where }),
    TransactionLedger.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
      include: ACCOUNT_LEDGER_INCLUDES,
    }),
  ]);

  return {
    items: rows.map((r) => serializeLedgerMovement(r)),
    pagination: {
      total_rows: total,
      limit,
      offset,
    },
    reference_types_known: TransactionLedger.REF_TYPES || [],
    filters_applied: {
      reference_type: rtRaw || null,
      occurred_from: fromDt && Number.isFinite(fromDt.getTime()) ? fromDt.toISOString() : null,
      occurred_to: toDt && Number.isFinite(toDt.getTime()) ? toDt.toISOString() : null,
    },
    currency_hint: 'BRL',
    note_partidas:
      'Cada lançamento expõe `debit` e `credit` com montante sempre positivo.',
  };
}

const TARGET_BY_ACTION = Object.freeze({
  approve: 'APPROVED',
  processing: 'PROCESSING',
  paid: 'PAID',
  reject: 'REJECTED',
  fail: 'FAILED',
});

const AUDIT_ACTION_BY_STATUS = Object.freeze({
  APPROVED: 'ADMIN_PAYOUT_APPROVE',
  PROCESSING: 'ADMIN_PAYOUT_PROCESSING',
  PAID: 'ADMIN_PAYOUT_MARK_PAID',
  REJECTED: 'ADMIN_PAYOUT_REJECT',
  FAILED: 'ADMIN_PAYOUT_FAIL',
});

function payoutSnapshot(r) {
  return {
    status: r.status,
    paid_at: r.paid_at,
    processed_at: r.processed_at,
    specialist_id: r.specialist_id,
    amount: r.amount != null ? Number(r.amount) : null,
    external_transfer_id: r.external_transfer_id || null,
    rejection_reason: r.rejection_reason || null,
  };
}

/**
 * Transição do saque pela Gestora (máquina de estados em payouts.state.js).
 * PAID debita SPECIALIST_EARNINGS e cria o lançamento PAYOUT na mesma transação.
 */
async function transitionPayout(actorUserId, payoutId, targetStatus, body = {}, httpCtx = {}) {
  const gid = `${payoutId || ''}`.trim();
  const adminId = `${actorUserId || ''}`.trim();
  if (!gid) throw new AppError('ID de repasse omisso.', 400, null, true);

  const probe = await PayoutRequest.findByPk(gid, { paranoid: true, attributes: ['id', 'specialist_id'] });
  if (!probe) throw new AppError('Pedido de repasse não encontrado.', 404, null, true);

  const reason = `${body.reason ?? body.rejection_reason ?? body.motivo ?? ''}`.trim().slice(0, 900);
  if ((targetStatus === 'REJECTED' || targetStatus === 'FAILED') && !reason) {
    throw new AppError('Informe o motivo (`reason`).', 400, null, true);
  }

  let before;
  let after;
  let ledgerInfo = null;

  await sequelize.transaction(async (t) => {
    await lockSpecialistFinance(probe.specialist_id, t);
    const row = await PayoutRequest.findByPk(gid, { paranoid: true, transaction: t, lock: t.LOCK.UPDATE });
    if (!row) throw new AppError('Pedido de repasse não encontrado.', 404, null, true);
    before = payoutSnapshot(row);

    assertTransition(row.status, targetStatus);

    const now = new Date();
    const patch = { status: targetStatus, processed_by_user_id: adminId || null };
    if (targetStatus === 'PAID') {
      const extRaw = `${body.external_transfer_id ?? body.externalTransferId ?? ''}`.trim().slice(0, 128);
      patch.external_transfer_id = extRaw || row.external_transfer_id || null;
      patch.paid_at = now;
      patch.processed_at = now;
    } else if (targetStatus === 'REJECTED' || targetStatus === 'FAILED') {
      patch.rejection_reason = reason;
      patch.processed_at = now;
    } else {
      patch.processed_at = now;
    }
    await row.update(patch, { transaction: t });

    if (targetStatus === 'PAID') {
      ledgerInfo = await postPayoutDebit(row, adminId, t);
    }
    after = payoutSnapshot(row);

    await persistAdminAuditLog(
      {
        admin_id: adminId,
        action: AUDIT_ACTION_BY_STATUS[targetStatus],
        target_entity: 'PayoutRequest',
        target_id: row.id,
        old_value: before,
        new_value: after,
        metadata: {
          ...(body?.notes ? { notes: `${body.notes}`.slice(0, 900) } : {}),
          ...(ledgerInfo ? { ledger_id: ledgerInfo.ledger_id } : {}),
        },
        httpCtx: {
          ip: httpCtx.ip,
          user_agent: httpCtx.userAgent,
          correlation_id: httpCtx.correlationId,
        },
      },
      { transaction: t }
    );
  });

  const fresh = await PayoutRequest.findByPk(gid, { paranoid: true });
  return {
    payout_id: fresh?.id || gid,
    status: fresh?.status,
    amount: fresh?.amount != null ? Number(fresh.amount) : null,
    specialist_id: fresh?.specialist_id,
    paid_at: fresh?.paid_at,
    processed_at: fresh?.processed_at,
    rejection_reason: fresh?.rejection_reason || null,
    ledger_id: ledgerInfo?.ledger_id || null,
  };
}

/** Compatível com a rota antiga `PATCH /finance/payouts/:id`: marca como PAGO (exige APPROVED/PROCESSING). */
function markPayoutAsPaid(actorUserId, payoutId, body = {}, httpCtx = {}) {
  return transitionPayout(actorUserId, payoutId, 'PAID', body, httpCtx);
}

async function listPayoutRequests(query = {}) {
  let limit = parseInt(`${query.limit ?? 50}`, 10);
  if (!Number.isFinite(limit)) limit = 50;
  limit = Math.min(Math.max(limit, 1), 200);
  let offset = parseInt(`${query.offset ?? 0}`, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const where = {};
  const st = `${query.status || ''}`.trim().toUpperCase();
  if (st && PayoutRequest.PAYOUT_STATUSES.includes(st)) where.status = st;
  const sid = `${query.specialist_id || ''}`.trim();
  if (sid) where.specialist_id = sid;

  const { count, rows } = await PayoutRequest.findAndCountAll({
    where,
    order: [['requested_at', 'DESC']],
    limit,
    offset,
    paranoid: true,
  });
  return {
    items: rows.map((r) => serializePayout(r)),
    pagination: { total_rows: count, limit, offset },
    statuses_known: PayoutRequest.PAYOUT_STATUSES,
  };
}

async function financePulseSummary() {
  const [creditsSoldBrlRaw, walletsOpenRaw, paidOrdersCount, platformCredits] = await Promise.all([
    PaymentOrder.sum('amount', { where: { status: 'PAID' } }).catch(() => 0),
    LedgerAccount.sum('cached_balance', { where: { account_type: 'CLIENT_WALLET' } }).catch(() => 0),
    PaymentOrder.count({ where: { status: 'PAID' } }).catch(() => null),
    TransactionLedger.sum('amount', {
      include: [
        {
          model: LedgerAccount,
          as: 'credit_account',
          attributes: [],
          required: true,
          where: { account_type: 'PLATFORM_REVENUE' },
        },
      ],
    }).catch(() => 0),
  ]);

  const creditsSold = Number.parseFloat(`${creditsSoldBrlRaw ?? 0}`);
  const walletsSum = Number.parseFloat(`${walletsOpenRaw ?? 0}`);
  const platformSum = Number.parseFloat(`${platformCredits ?? 0}`);

  return {
    credits_sold_brl_total_paid_orders: Number.isFinite(creditsSold) ? creditsSold : 0,
    paid_orders_count:
      typeof paidOrdersCount === 'number' && Number.isFinite(paidOrdersCount) ? paidOrdersCount : null,
    client_wallets_cached_balance_total_open: Number.isFinite(walletsSum) ? walletsSum : 0,
    accumulated_platform_credit_to_revenue_account_brl_hint: Number.isFinite(platformSum) ? platformSum : 0,
    currency: 'BRL',
    note_legacy:
      'Resumo rápido; painel KPI completo está em `/api/v1/admin/metrics/dashboard` (motor `admin.metrics.service.js`).',
  };
}

module.exports = {
  listFinanceLedgerTransactions,
  markPayoutAsPaid,
  transitionPayout,
  listPayoutRequests,
  TARGET_BY_ACTION,
  financePulseSummary,
};
