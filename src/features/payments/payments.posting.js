'use strict';

/**
 * Único caminho de escrita no razão dos pagamentos (F-12/F-13/F-15).
 *
 *  - `ensureLedgerAccount`: cria a conta com INSERT ... ON CONFLICT DO NOTHING e só então trava
 *    (SELECT ... FOR UPDATE), porque FOR UPDATE não trava linha inexistente. Com os índices únicos
 *    da migração 20261029130000 duas criações simultâneas resultam em UMA conta.
 *  - `postEntry`: trava as duas contas em ordem de id, insere o lançamento de forma idempotente
 *    (chave única) e atualiza o `cached_balance` das duas contas no próprio SQL (DECIMAL exato do
 *    Postgres, sem Number). Convenção de saldo: crédito soma, débito subtrai.
 *
 * PLATFORM_SUSPENSE fica fora do cache de propósito: `sessions.economics` usa esse saldo como
 * limitador do split e quebraria com o saldo negativo das entradas do gateway. Ligar
 * `CACHE_PLATFORM_SUSPENSE` só depois que o limitador sair de lá (pendência registrada).
 */
const { randomUUID } = require('crypto');
const { sequelize } = require('../../config/database');
const AppError = require('../../utils/AppError');
const { toCents, centsToString } = require('./payments.money');

const CACHE_PLATFORM_SUSPENSE = false;
const CLIENT_TYPES = new Set(['CLIENT_WALLET', 'CLIENT_PACOTE_ESCROW']);

function cacheEnabledFor(accountType) {
  return accountType !== 'PLATFORM_SUSPENSE' || CACHE_PLATFORM_SUSPENSE;
}

/**
 * @param {{ accountType: string, clientId?: string|null, specialistId?: string|null, label?: string, initialCents?: number|null }} spec
 * @returns {Promise<{ id: string, account_type: string, cached_balance: string|null }>} conta já travada
 */
async function ensureLedgerAccount(spec, t) {
  const { accountType, clientId = null, specialistId = null, label = null, initialCents = null } = spec;
  const where = clientId
    ? { sql: 'client_id = :owner', owner: clientId }
    : specialistId
      ? { sql: 'specialist_id = :owner', owner: specialistId }
      : { sql: 'client_id IS NULL AND specialist_id IS NULL AND temp_client_id IS NULL', owner: null };

  const select = () =>
    sequelize.query(
      `SELECT id, account_type, cached_balance FROM ledger_accounts
        WHERE account_type = :accountType AND ${where.sql}
        ORDER BY created_at ASC, id ASC LIMIT 1 FOR UPDATE`,
      { replacements: { accountType, owner: where.owner }, transaction: t, type: sequelize.QueryTypes.SELECT }
    );

  let rows = await select();
  if (rows.length) return rows[0];

  await sequelize.query(
    `INSERT INTO ledger_accounts
       (id, account_type, client_id, specialist_id, currency, label, cached_balance, created_at, updated_at)
     VALUES (:id, :accountType, :clientId, :specialistId, 'BRL', :label, :bal, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    {
      replacements: {
        id: randomUUID(),
        accountType,
        clientId,
        specialistId,
        label,
        bal: initialCents == null ? null : centsToString(initialCents),
      },
      transaction: t,
    }
  );
  rows = await select();
  if (!rows.length) throw new AppError('Conta do razão indisponível após criação.', 500, null, false);
  return rows[0];
}

/**
 * @param {import('sequelize').Transaction} t
 * @param {{
 *  debitId: string, creditId: string, amountCents: number, referenceType: string, referenceId?: string|null,
 *  idempotencyKey?: string|null, description?: string, metadata?: object, occurredAt?: Date,
 *  allowNegativeDebit?: boolean
 * }} e
 * @returns {Promise<{ posted: boolean, duplicate: boolean, id: string|null }>}
 */
async function postEntry(t, e) {
  const cents = Number(e.amountCents);
  if (!Number.isInteger(cents) || cents < 0) {
    throw new AppError('Lançamento com valor inválido (centavos inteiros).', 500, null, false);
  }
  if (cents === 0) return { posted: false, duplicate: false, id: null };
  if (e.debitId === e.creditId) {
    throw new AppError('Lançamento com a mesma conta em débito e crédito.', 500, null, false);
  }

  const accounts = await sequelize.query(
    `SELECT id, account_type, cached_balance FROM ledger_accounts
      WHERE id IN (:a, :b) ORDER BY id ASC FOR UPDATE`,
    { replacements: { a: e.debitId, b: e.creditId }, transaction: t, type: sequelize.QueryTypes.SELECT }
  );
  const debit = accounts.find((x) => x.id === e.debitId);
  const credit = accounts.find((x) => x.id === e.creditId);
  if (!debit || !credit) throw new AppError('Conta do razão inexistente no lançamento.', 500, null, false);

  if (e.idempotencyKey) {
    const dup = await sequelize.query(
      'SELECT id FROM transaction_ledger WHERE idempotency_key = :k LIMIT 1',
      { replacements: { k: e.idempotencyKey }, transaction: t, type: sequelize.QueryTypes.SELECT }
    );
    if (dup.length) return { posted: false, duplicate: true, id: dup[0].id };
  }

  if (CLIENT_TYPES.has(debit.account_type) && !e.allowNegativeDebit) {
    const bal = toCents(debit.cached_balance) ?? 0;
    if (bal < cents) {
      throw new AppError('Saldo insuficiente para o débito.', 409, { code: 'INSUFFICIENT_BALANCE' }, true);
    }
  }

  const ins = await sequelize.query(
    `INSERT INTO transaction_ledger
       (id, debit_account_id, credit_account_id, amount, reference_type, reference_id,
        idempotency_key, description, metadata, occurred_at, created_at)
     VALUES (:id, :d, :c, :amt, :rt, :rid, :ik, :descr, CAST(:meta AS jsonb), :occ, NOW())
     ON CONFLICT DO NOTHING RETURNING id`,
    {
      replacements: {
        id: randomUUID(),
        d: e.debitId,
        c: e.creditId,
        amt: centsToString(cents),
        rt: e.referenceType,
        rid: e.referenceId || null,
        ik: e.idempotencyKey || null,
        descr: e.description ? String(e.description).slice(0, 512) : null,
        meta: e.metadata ? JSON.stringify(e.metadata) : null,
        occ: e.occurredAt || new Date(),
      },
      transaction: t,
      type: sequelize.QueryTypes.SELECT,
    }
  );
  if (!ins.length) return { posted: false, duplicate: true, id: null };

  const bump = (id, sign) =>
    sequelize.query(
      `UPDATE ledger_accounts
          SET cached_balance = COALESCE(cached_balance, 0) ${sign} :amt, updated_at = NOW()
        WHERE id = :id`,
      { replacements: { amt: centsToString(cents), id }, transaction: t }
    );
  if (cacheEnabledFor(credit.account_type)) await bump(credit.id, '+');
  if (cacheEnabledFor(debit.account_type)) await bump(debit.id, '-');

  return { posted: true, duplicate: false, id: ins[0].id };
}

/** Saldo em centavos lido do banco (a conta deve estar travada pelo chamador se for decidir algo). */
async function readBalanceCents(accountId, t) {
  const rows = await sequelize.query('SELECT cached_balance FROM ledger_accounts WHERE id = :id', {
    replacements: { id: accountId },
    transaction: t,
    type: sequelize.QueryTypes.SELECT,
  });
  return toCents(rows[0]?.cached_balance) ?? 0;
}

module.exports = { ensureLedgerAccount, postEntry, readBalanceCents, CLIENT_TYPES };
