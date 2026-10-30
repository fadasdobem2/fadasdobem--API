'use strict';

const { Op } = require('sequelize');
const { PayoutRequest, Specialist, LedgerAccount } = require('../../models');
const { sequelize } = require('../../config/database');
const AppError = require('../../utils/AppError');
const { toUnits, fromUnits, parseCentavosStrict } = require('../../utils/moneyUnits.util');
const { validatePixKey } = require('./payouts.pix');
const { OPEN_RESERVING_STATUSES, lockSpecialistFinance, ensureEarningsAccount } = require('./payouts.state');

async function specialistProfileForUserId(userId) {
  const uid = `${userId || ''}`.trim();
  if (!uid) return null;
  return Specialist.findOne({
    where: { user_id: uid },
    paranoid: true,
    attributes: ['id', 'user_id', 'is_blocked', 'registration_approval_status'],
  });
}

/**
 * Saldo em `SPECIALIST_EARNINGS.cached_balance` menos pedidos já reservados (PENDING/PROCESSING/APPROVED).
 * Saques PAID já saíram do saldo via lançamento PAYOUT (ver payouts.state.js). Aritmética em unidades inteiras.
 * Com `transaction`, trava a conta e serializa pela taróloga (advisory lock).
 */
async function getAvailablePayoutCapacityBrl(specialistId, transaction) {
  const sid = `${specialistId || ''}`.trim();
  if (!sid) return 0;

  if (transaction) await lockSpecialistFinance(sid, transaction);
  const acc = transaction
    ? await ensureEarningsAccount(sid, transaction)
    : await LedgerAccount.findOne({ where: { specialist_id: sid, account_type: 'SPECIALIST_EARNINGS' } });
  const balU = toUnits(acc?.cached_balance ?? 0) ?? 0;

  const reservedRaw = await PayoutRequest.sum('amount', {
    where: { specialist_id: sid, status: { [Op.in]: OPEN_RESERVING_STATUSES } },
    ...(transaction ? { transaction } : {}),
  });
  const reservedU = toUnits(reservedRaw ?? 0) ?? 0;

  return fromUnits(balU - reservedU) ?? 0;
}

function serializePayout(row) {
  const p = typeof row?.toJSON === 'function' ? row.toJSON() : row || {};
  return {
    id: p.id,
    specialist_id: p.specialist_id,
    amount: p.amount != null ? Number(p.amount) : null,
    status: p.status,
    pix_key: p.pix_key || p.pix_destination || null,
    pix_destination: p.pix_destination || null,
    pix_type: p.pix_type || null,
    requested_at: p.requested_at,
    processed_at: p.processed_at || p.paid_at || null,
    paid_at: p.paid_at || null,
    rejection_reason: p.rejection_reason || null,
  };
}

async function requestPayout(userId, body = {}) {
  const specialist = await specialistProfileForUserId(userId);
  if (!specialist) throw new AppError('Perfil tarólogo não encontrado.', 403, null, true);
  if (specialist.is_blocked) {
    throw new AppError('Conta bloqueada: não é possível solicitar saque.', 403, null, true);
  }
  if (`${specialist.registration_approval_status || ''}`.toUpperCase() !== 'APPROVED') {
    throw new AppError('Cadastro ainda não aprovado: não é possível solicitar saque.', 403, null, true);
  }

  let pix;
  try {
    pix = validatePixKey(body.pix_type ?? body.pixType, body.pix_key ?? body.pixKey);
  } catch (e) {
    if (e?.code === 'PIX_INVALID') throw new AppError(e.message, 400, null, true);
    throw e;
  }

  const amount = parseCentavosStrict(body.amount);
  if (!amount || amount <= 0) {
    throw new AppError(
      'amount inválido: informe um valor positivo em BRL com no máximo 2 casas decimais.',
      400,
      null,
      true
    );
  }

  return sequelize.transaction(async (t) => {
    const available = await getAvailablePayoutCapacityBrl(specialist.id, t);
    if (toUnits(available) < toUnits(amount)) {
      throw new AppError(
        `Saldo disponível insuficiente para este saque (${available ?? 0} BRL após deduzir pedidos pendentes).`,
        400,
        { available_brl: available, requested_brl: amount },
        true
      );
    }

    const row = await PayoutRequest.create(
      {
        specialist_id: specialist.id,
        amount,
        status: 'PENDING',
        pix_destination: pix.key.slice(0, 256),
        pix_key: pix.key.slice(0, 256),
        pix_type: pix.type,
        gross_reference_amount: amount,
      },
      { transaction: t }
    );

    return serializePayout(row);
  });
}

async function listMyPayoutRequests(userId) {
  const specialist = await specialistProfileForUserId(userId);
  if (!specialist) throw new AppError('Perfil tarólogo não encontrado.', 403, null, true);

  const rows = await PayoutRequest.findAll({
    where: { specialist_id: specialist.id },
    order: [['requested_at', 'DESC']],
    limit: 200,
    paranoid: true,
  });

  return { payout_requests: rows.map(serializePayout) };
}

module.exports = {
  specialistProfileForUserId,
  getAvailablePayoutCapacityBrl,
  serializePayout,
  requestPayout,
  listMyPayoutRequests,
};
