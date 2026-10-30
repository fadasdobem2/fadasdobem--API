'use strict';

/**
 * Tabela para solicitações de recuperação/sincronização de conta.
 * Criada quando o usuário não tem mais acesso ao email/telefone original
 * e precisa de intervenção do admin para reunir a conta antiga com a nova conta temporária.
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_account_recovery_requests_sync_stage" AS ENUM (
        'PENDING_REVIEW',
        'IDENTITY_CHECK',
        'MERGING',
        'MERGED',
        'REJECTED',
        'CANCELLED'
      );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_account_recovery_requests_declared_old_access_channel" AS ENUM (
        'EMAIL',
        'WHATSAPP',
        'BOTH',
        'UNKNOWN'
      );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS account_recovery_requests (
        id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

        -- Conta temporária em temporary_users (separada de users)
        temp_account_id                 UUID          NOT NULL
          REFERENCES temporary_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,

        -- Conta original na tabela users localizada pelo admin
        original_user_id                UUID          NULL
          REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,

        -- Dados declarados pelo usuário
        declared_full_name              VARCHAR(255)  NOT NULL,
        declared_old_email              VARCHAR(320)  NULL,
        declared_old_phone              VARCHAR(32)   NULL,
        declared_old_access_channel     "enum_account_recovery_requests_declared_old_access_channel"
                                                      NOT NULL DEFAULT 'UNKNOWN',

        -- Pistas de identidade
        identity_hint_nickname          VARCHAR(128)  NULL,
        identity_hint_specialists       TEXT          NULL,
        identity_hint_extra             JSONB         NOT NULL DEFAULT '{}',

        -- Controle de etapa
        sync_stage                      "enum_account_recovery_requests_sync_stage"
                                                      NOT NULL DEFAULT 'PENDING_REVIEW',
        stage_updated_at                TIMESTAMPTZ   NULL,

        -- Admin responsável
        assigned_admin_id               UUID          NULL
          REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        admin_notes                     TEXT          NULL,
        rejection_reason                VARCHAR(512)  NULL,

        -- Rastreio de origem (anti-fraude)
        request_ip                      VARCHAR(45)   NULL,
        request_user_agent              VARCHAR(512)  NULL,
        request_metadata                JSONB         NOT NULL DEFAULT '{}',

        -- Resolução final
        merged_at                       TIMESTAMPTZ   NULL,
        cancelled_at                    TIMESTAMPTZ   NULL,
        expires_at                      TIMESTAMPTZ   NULL,

        -- Timestamps padrão (paranoid soft-delete)
        created_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        deleted_at                      TIMESTAMPTZ   NULL
      );
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS arr_temp_account_id_idx
        ON account_recovery_requests (temp_account_id);
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS arr_original_user_id_idx
        ON account_recovery_requests (original_user_id)
        WHERE original_user_id IS NOT NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS arr_sync_stage_idx
        ON account_recovery_requests (sync_stage)
        WHERE deleted_at IS NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS arr_assigned_admin_id_idx
        ON account_recovery_requests (assigned_admin_id)
        WHERE assigned_admin_id IS NOT NULL AND deleted_at IS NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS arr_declared_old_email_idx
        ON account_recovery_requests (declared_old_email)
        WHERE declared_old_email IS NOT NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS arr_declared_old_phone_idx
        ON account_recovery_requests (declared_old_phone)
        WHERE declared_old_phone IS NOT NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS arr_expires_at_idx
        ON account_recovery_requests (expires_at)
        WHERE expires_at IS NOT NULL AND deleted_at IS NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS arr_created_at_idx
        ON account_recovery_requests (created_at DESC);
    `);
  },

  async down({ sequelize }) {
    await sequelize.query(`DROP TABLE IF EXISTS account_recovery_requests;`);
    await sequelize.query(`DROP TYPE IF EXISTS "enum_account_recovery_requests_sync_stage";`);
    await sequelize.query(`DROP TYPE IF EXISTS "enum_account_recovery_requests_declared_old_access_channel";`);
  },
};
