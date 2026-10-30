'use strict';

/**
 * Recrutamento de tarólogas — funil separado de `specialists` operacionais.
 * Tabela: specialist_candidates (candidatos em inglês, alinhado ao pedido do produto).
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_specialist_candidates_estado" AS ENUM (
          'nova', 'em_analise', 'aprovada', 'em_onboarding', 'reprovada', 'arquivada'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_specialist_candidates_triagem" AS ENUM ('pendente', 'em_espera');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS specialist_candidates (
        id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

        apelido                         VARCHAR(160)  NOT NULL,
        nome_civil                      VARCHAR(160)  NULL,
        email                           VARCHAR(320)  NULL,
        whatsapp                        VARCHAR(32)   NULL,
        origem                          VARCHAR(64)   NOT NULL DEFAULT 'Site',
        estado                          "enum_specialist_candidates_estado" NOT NULL DEFAULT 'nova',
        triagem                         "enum_specialist_candidates_triagem" NULL DEFAULT 'pendente',
        grad                            VARCHAR(8)    NULL,
        idade                           SMALLINT      NULL,
        chegou_em                       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        decidida_em                     TIMESTAMPTZ   NULL,
        razao                           TEXT          NULL,
        espera_desde                    TIMESTAMPTZ   NULL,
        espera_motivo                   VARCHAR(64)   NULL,
        espera_nota                     TEXT          NULL,

        f1                              JSONB         NOT NULL DEFAULT '{}',
        proc                            JSONB         NOT NULL DEFAULT '{}',
        convite                         JSONB         NULL,
        onb                             JSONB         NULL,
        f2                              JSONB         NULL,
        f2_original                     JSONB         NULL,

        onboarding_token                VARCHAR(64)   NULL,
        onboarding_token_expires_at     TIMESTAMPTZ   NULL,

        specialist_id                   UUID          NULL
          REFERENCES specialists(id) ON DELETE SET NULL ON UPDATE CASCADE,
        user_id                         UUID          NULL
          REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        created_by_user_id              UUID          NULL
          REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,

        created_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        deleted_at                      TIMESTAMPTZ   NULL
      );
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS sc_estado_idx
        ON specialist_candidates (estado)
        WHERE deleted_at IS NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS sc_triagem_idx
        ON specialist_candidates (triagem)
        WHERE deleted_at IS NULL AND estado = 'nova';
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS sc_estado_chegou_idx
        ON specialist_candidates (estado, chegou_em DESC)
        WHERE deleted_at IS NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS sc_email_lower_idx
        ON specialist_candidates (lower(email))
        WHERE deleted_at IS NULL AND email IS NOT NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS sc_apelido_idx
        ON specialist_candidates (apelido)
        WHERE deleted_at IS NULL;
    `);
    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS sc_onboarding_token_uidx
        ON specialist_candidates (onboarding_token)
        WHERE onboarding_token IS NOT NULL AND deleted_at IS NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS sc_specialist_id_idx
        ON specialist_candidates (specialist_id)
        WHERE specialist_id IS NOT NULL AND deleted_at IS NULL;
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS specialist_private_profiles (
        id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        specialist_id                   UUID          NOT NULL
          REFERENCES specialists(id) ON DELETE CASCADE ON UPDATE CASCADE,
        nome_civil                      VARCHAR(160)  NULL,
        cpf                             VARCHAR(14)   NULL,
        rg                              VARCHAR(32)   NULL,
        data_nascimento                 DATE          NULL,
        endereco                        JSONB         NOT NULL DEFAULT '{}',
        contato_emergencia              JSONB         NOT NULL DEFAULT '{}',
        dados_bancarios                 JSONB         NOT NULL DEFAULT '{}',
        contrato_url                    VARCHAR(512)  NULL,
        contrato_assinado_em            TIMESTAMPTZ   NULL,
        created_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        deleted_at                      TIMESTAMPTZ   NULL
      );
    `);

    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS spp_specialist_id_uidx
        ON specialist_private_profiles (specialist_id)
        WHERE deleted_at IS NULL;
    `);
    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS spp_cpf_uidx
        ON specialist_private_profiles (cpf)
        WHERE deleted_at IS NULL AND cpf IS NOT NULL;
    `);

    await sequelize.query(`
      ALTER TABLE specialists
        ADD COLUMN IF NOT EXISTS slug VARCHAR(160) NULL,
        ADD COLUMN IF NOT EXISTS candidate_id UUID NULL
          REFERENCES specialist_candidates(id) ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS specialists_slug_deleted_at_null_uidx
        ON specialists (slug)
        WHERE deleted_at IS NULL AND slug IS NOT NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS specialists_candidate_id_idx
        ON specialists (candidate_id)
        WHERE candidate_id IS NOT NULL AND deleted_at IS NULL;
    `);
  },

  async down({ sequelize }) {
    await sequelize.query(`ALTER TABLE specialists DROP COLUMN IF EXISTS candidate_id;`);
    await sequelize.query(`ALTER TABLE specialists DROP COLUMN IF EXISTS slug;`);
    await sequelize.query(`DROP TABLE IF EXISTS specialist_private_profiles;`);
    await sequelize.query(`DROP TABLE IF EXISTS specialist_candidates;`);
    await sequelize.query(`DROP TYPE IF EXISTS "enum_specialist_candidates_triagem";`);
    await sequelize.query(`DROP TYPE IF EXISTS "enum_specialist_candidates_estado";`);
  },
};
