'use strict';

/**
 * Financeiro (saques e fecho de sessão). Tudo idempotente, sem apagar nem alterar linhas existentes.
 *
 *  1) Enum de conta do razão: PLATFORM_PAYOUT_CLEARING (conta de passagem do saque pago: débito
 *     SPECIALIST_EARNINGS, crédito esta conta, reference_type PAYOUT).
 *  2) sessions.economics_uncollected_amount: parte do consumo que o saldo do cliente não cobriu no fecho
 *     (rastro explícito; antes a sessão era marcada liquidada sem nenhum registro da diferença).
 *  3) Índice de apoio à reconciliação: sessões COMPLETED ainda sem fecho econômico.
 *  4) Índice de apoio à reserva de saldo: sessões abertas por cliente.
 */
module.exports = {
  async up({ sequelize }) {
    const q = (sql) => sequelize.query(sql);

    await q(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_ledger_accounts_account_type') THEN
          ALTER TYPE "enum_ledger_accounts_account_type" ADD VALUE IF NOT EXISTS 'PLATFORM_PAYOUT_CLEARING';
        END IF;
      END $$
    `);

    await q(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sessions') THEN
          ALTER TABLE sessions ADD COLUMN IF NOT EXISTS economics_uncollected_amount DECIMAL(14,4);
          CREATE INDEX IF NOT EXISTS sessions_unsettled_completed_idx
            ON sessions (ended_at) WHERE telecom_status = 'COMPLETED' AND economics_settled_at IS NULL AND deleted_at IS NULL;
          CREATE INDEX IF NOT EXISTS sessions_open_by_client_idx
            ON sessions (client_id) WHERE ended_at IS NULL AND deleted_at IS NULL;
        END IF;
      END $$
    `);
  },
};
