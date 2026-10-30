'use strict';

/**
 * Tabelas para contas temporárias de recuperação de acesso.
 * Contas aqui funcionam como usuários normais (sessões, pagamentos, etc.)
 * mas vivem separadas de `users` até o admin sincronizar com a conta original.
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS temporary_users (
        id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        email                     VARCHAR(320)  NOT NULL,
        password_hash             VARCHAR(255)  NOT NULL,
        role                      VARCHAR(32)   NOT NULL DEFAULT 'CLIENTE',
        is_active                 BOOLEAN       NOT NULL DEFAULT true,
        blocked_at                TIMESTAMPTZ   NULL,
        block_reason              TEXT          NULL,
        last_login_at             TIMESTAMPTZ   NULL,
        phone                     VARCHAR(32)   NULL,
        openai_thread_id          VARCHAR(128)  NULL,
        onboarding_step           SMALLINT      NOT NULL DEFAULT 1,
        email_verified_at         TIMESTAMPTZ   NULL,
        accepted_terms_version    VARCHAR(32)   NULL,
        accepted_terms_at         TIMESTAMPTZ   NULL,
        created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        deleted_at                TIMESTAMPTZ   NULL,
        CONSTRAINT temporary_users_email_active_uidx UNIQUE (email)
      );
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS tu_email_idx ON temporary_users (email) WHERE deleted_at IS NULL;
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS temporary_clients (
        id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        temp_user_id              UUID          NOT NULL
          REFERENCES temporary_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        nome_completo             VARCHAR(160)  NULL,
        nome_id                   VARCHAR(160)  NULL,
        nome                      VARCHAR(160)  NULL,
        apelido                   VARCHAR(80)   NULL,
        tratar_por                VARCHAR(120)  NULL,
        data_nascimento           DATE          NULL,
        cpf                       VARCHAR(14)   NULL,
        pricing_level_id          UUID          NULL
          REFERENCES pricing_levels(id) ON DELETE SET NULL ON UPDATE CASCADE,
        internal_notes            TEXT          NULL,
        first_completed_session_at TIMESTAMPTZ  NULL,
        loyalty_tier_cached       VARCHAR(64)   NULL,
        created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        deleted_at                TIMESTAMPTZ   NULL,
        CONSTRAINT temporary_clients_temp_user_active_uidx UNIQUE (temp_user_id)
      );
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS tc_pricing_level_idx ON temporary_clients (pricing_level_id);
      CREATE INDEX IF NOT EXISTS tc_temp_user_id_idx ON temporary_clients (temp_user_id);
    `);
  },

  async down({ sequelize }) {
    await sequelize.query(`DROP TABLE IF EXISTS temporary_clients;`);
    await sequelize.query(`DROP TABLE IF EXISTS temporary_users;`);
  },
};
