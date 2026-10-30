'use strict';

/**
 * Saldo disponível para abrir/continuar sessões e reserva entre sessões simultâneas do mesmo cliente.
 *
 * - Na criação: o cliente precisa ter pelo menos `SESSION_MIN_BALANCE_MINUTES` (default 1) minuto do preço
 *   aplicado, em pacote compatível ou na carteira, já descontada a reserva das sessões abertas dele.
 *   Desligável com SESSION_REQUIRE_MIN_BALANCE=false. O valor mínimo e o pós-pago são decisão da Nice.
 * - No cronômetro: o saldo da carteira vale só o que sobra depois do consumo já acumulado pelas OUTRAS
 *   sessões abertas do mesmo cliente (antes cada uma enxergava o saldo inteiro).
 */
const { Op } = require('sequelize');
const { Session, LedgerAccount, ClientCreditLot } = require('../../models');
const AppError = require('../../utils/AppError');
const { toUnits } = require('../../utils/moneyUnits.util');
const { sessionModalityMatchesPacoteLot } = require('../payments/payments.modalities');

const OPEN_TELECOM = ['PENDING', 'ACTIVE', 'WARNING'];

function requireMinBalance() {
  return `${process.env.SESSION_REQUIRE_MIN_BALANCE ?? ''}`.trim().toLowerCase() !== 'false';
}

function minBalanceMinutes() {
  const n = Number.parseInt(`${process.env.SESSION_MIN_BALANCE_MINUTES ?? ''}`.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/** Serializa criação de sessões do mesmo cliente (a transação segura o lock até o commit). */
async function lockClientSessions(clientKey, t) {
  await t.sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:k))', {
    replacements: { k: `fin:client-sessions:${clientKey}` },
    transaction: t,
  });
}

/**
 * Unidades (1/10000 BRL) reservadas pelas outras sessões abertas do cliente no trilho carteira.
 * @param {{ minReserve?: boolean }} opts `minReserve`: cada sessão reserva no mínimo 1 min do próprio preço.
 */
async function siblingWalletReservedUnits(clientColumn, clientId, excludeSessionId, t, opts = {}) {
  const where = {
    [clientColumn]: clientId,
    telecom_status: { [Op.in]: OPEN_TELECOM },
    ended_at: { [Op.is]: null },
    billing_track: { [Op.or]: [{ [Op.is]: null }, 'CLIENT_WALLET'] },
  };
  if (excludeSessionId) where.id = { [Op.ne]: excludeSessionId };
  const rows = await Session.findAll({
    where,
    attributes: ['id', 'paid_minutes_used', 'minute_price_applied_snapshot'],
    paranoid: true,
    ...(t ? { transaction: t } : {}),
  });
  let total = 0;
  for (const r of rows) {
    const priceU = toUnits(r.minute_price_applied_snapshot) ?? 0;
    const paid = Math.max(0, Math.floor(Number(r.paid_minutes_used ?? 0)));
    const accrued = paid * priceU;
    total += opts.minReserve ? Math.max(accrued, priceU) : accrued;
  }
  return total;
}

/**
 * Recusa (402) a criação de sessão sem saldo mínimo. Chamar dentro da transação com o advisory lock.
 * Só cliente regular (`client_id`); contas temporárias não têm carteira no razão por `client_id`.
 */
async function assertClientCanOpenSession({ clientColumn, clientId, minutePrice, modality }, t) {
  if (!requireMinBalance() || clientColumn !== 'client_id') return;
  const priceU = toUnits(minutePrice) ?? 0;
  const needU = priceU * minBalanceMinutes();
  if (!(needU > 0)) return;

  const lots = await ClientCreditLot.findAll({
    where: {
      client_id: clientId,
      credit_type: 'PACOTE_SESSAO_UNICA',
      consumed_at: { [Op.is]: null },
      binding_session_id: { [Op.is]: null },
      is_locked: false,
      remaining_amount: { [Op.gt]: 0 },
    },
    order: [['created_at', 'ASC']],
    limit: 1,
    transaction: t,
    paranoid: true,
  });
  const lot = lots[0];
  if (
    lot &&
    sessionModalityMatchesPacoteLot(`${modality || ''}`.toUpperCase(), lot.consumption_modalities) &&
    (toUnits(lot.remaining_amount) ?? 0) >= needU
  ) {
    return;
  }

  const wallet = await LedgerAccount.findOne({
    where: { client_id: clientId, account_type: 'CLIENT_WALLET' },
    attributes: ['id', 'cached_balance'],
    transaction: t,
  });
  const balU = toUnits(wallet?.cached_balance ?? 0) ?? 0;
  const reservedU = await siblingWalletReservedUnits(clientColumn, clientId, null, t, { minReserve: true });
  if (balU - reservedU < needU) {
    throw new AppError(
      'Saldo insuficiente para iniciar a sessão. Adicione crédito e tente novamente.',
      402,
      { code: 'INSUFFICIENT_BALANCE', required_brl: needU / 10000, available_brl: Math.max(0, balU - reservedU) / 10000 },
      true
    );
  }
}

module.exports = {
  OPEN_TELECOM,
  lockClientSessions,
  siblingWalletReservedUnits,
  assertClientCanOpenSession,
};
