'use strict';

/**
 * Máquina de estados do saque + lançamento de saída no razão.
 *
 *   PENDING    -> APPROVED | REJECTED
 *   APPROVED   -> PROCESSING | PAID | REJECTED | FAILED
 *   PROCESSING -> PAID | FAILED
 *   PAID | REJECTED | FAILED -> (terminais)
 *
 * Reserva: pedidos PENDING/APPROVED/PROCESSING reduzem a capacidade de saque (sem lançamento).
 * Dinheiro só sai do saldo (SPECIALIST_EARNINGS) quando o pedido vira PAID: débito ganhos,
 * crédito PLATFORM_PAYOUT_CLEARING, `reference_type = 'PAYOUT'`, chave idempotente `payout-<id>`.
 */
const { Op } = require('sequelize');
const { LedgerAccount, TransactionLedger } = require('../../models');
const AppError = require('../../utils/AppError');
const { toUnits, fromUnits } = require('../../utils/moneyUnits.util');

const OPEN_RESERVING_STATUSES = ['PENDING', 'APPROVED', 'PROCESSING'];

const TRANSITIONS = Object.freeze({
  PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSING', 'PAID', 'REJECTED', 'FAILED'],
  PROCESSING: ['PAID', 'FAILED'],
  PAID: [],
  REJECTED: [],
  FAILED: [],
});

function assertTransition(from, to) {
  const f = `${from || ''}`.toUpperCase();
  const t = `${to || ''}`.toUpperCase();
  const allowed = TRANSITIONS[f];
  if (!allowed) throw new AppError(`Estado de saque desconhecido: ${f || '(vazio)'}.`, 409, null, true);
  if (!allowed.includes(t)) {
    const msg =
      f === t || allowed.length === 0
        ? `Pedido já está em ${f} e não aceita a transição para ${t}.`
        : `Transição inválida de ${f} para ${t}. Permitidas: ${allowed.join(', ')}.`;
    throw new AppError(msg, 409, { from: f, to: t, allowed }, true);
  }
}

/** Serializa operações financeiras da mesma taróloga (protege também a criação da conta inexistente). */
async function lockSpecialistFinance(specialistId, t) {
  await t.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:k))', {
    replacements: { k: `fin:specialist:${specialistId}` },
    transaction: t,
  });
}

async function ensureEarningsAccount(specialistId, t) {
  const where = { specialist_id: specialistId, account_type: 'SPECIALIST_EARNINGS' };
  let acc = await LedgerAccount.findOne({ where, transaction: t, lock: t.LOCK.UPDATE });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        ...where,
        currency: 'BRL',
        label: `Ganhos tarólogo ${String(specialistId).slice(0, 8)}…`,
        cached_balance: 0,
      },
      { transaction: t }
    );
  }
  return acc;
}

async function ensurePayoutClearingAccount(t) {
  await t.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:k))', {
    replacements: { k: 'fin:platform:payout-clearing' },
    transaction: t,
  });
  let acc = await LedgerAccount.findOne({
    where: { account_type: 'PLATFORM_PAYOUT_CLEARING', client_id: { [Op.is]: null }, specialist_id: { [Op.is]: null } },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!acc) {
    acc = await LedgerAccount.create(
      {
        account_type: 'PLATFORM_PAYOUT_CLEARING',
        currency: 'BRL',
        label: 'Repasses pagos a tarólogas (conta de passagem)',
        cached_balance: 0,
      },
      { transaction: t }
    );
  }
  return acc;
}

/**
 * Debita SPECIALIST_EARNINGS pelo valor do saque. Chamar dentro da transação, com a linha do saque
 * já travada (FOR UPDATE) e o advisory lock da taróloga adquirido. Idempotente por `payout-<id>`.
 * @returns {Promise<{ posted: boolean, ledger_id: string|null, balance_after: number }>}
 */
async function postPayoutDebit(row, actorUserId, t) {
  const key = `payout-${row.id}`;
  const acc = await ensureEarningsAccount(row.specialist_id, t);
  const existing = await TransactionLedger.findOne({ where: { idempotency_key: key }, transaction: t });
  if (existing) {
    return { posted: false, ledger_id: existing.id, balance_after: Number(acc.cached_balance ?? 0) };
  }

  const amountU = toUnits(row.amount);
  const balU = toUnits(acc.cached_balance ?? 0);
  if (!(amountU > 0)) throw new AppError('Valor do saque inválido.', 409, null, true);
  if (balU < amountU) {
    throw new AppError(
      'Saldo de ganhos da taróloga é menor que o valor do saque; não é possível marcar como pago.',
      409,
      { balance_brl: fromUnits(balU), amount_brl: fromUnits(amountU) },
      true
    );
  }

  const clearing = await ensurePayoutClearingAccount(t);
  const led = await TransactionLedger.create(
    {
      debit_account_id: acc.id,
      credit_account_id: clearing.id,
      amount: fromUnits(amountU),
      reference_type: 'PAYOUT',
      reference_id: row.id,
      idempotency_key: key,
      description: `Saque pago via PIX · taróloga ${row.specialist_id}`,
      metadata: { payout_id: row.id, external_transfer_id: row.external_transfer_id || null },
      occurred_at: new Date(),
      created_by_user_id: actorUserId || null,
    },
    { transaction: t }
  );

  const after = fromUnits(balU - amountU);
  await acc.update({ cached_balance: after }, { transaction: t });
  const clrU = toUnits(clearing.cached_balance ?? 0);
  await clearing.update({ cached_balance: fromUnits(clrU + amountU) }, { transaction: t });
  return { posted: true, ledger_id: led.id, balance_after: after };
}

module.exports = {
  OPEN_RESERVING_STATUSES,
  TRANSITIONS,
  assertTransition,
  lockSpecialistFinance,
  ensureEarningsAccount,
  ensurePayoutClearingAccount,
  postPayoutDebit,
};
