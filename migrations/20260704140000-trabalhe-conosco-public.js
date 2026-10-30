'use strict';

/**
 * Trabalhe Conosco — categoria/meta em candidatas + candidaturas "Outras áreas".
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      ALTER TABLE specialist_candidates
        ADD COLUMN IF NOT EXISTS categoria VARCHAR(32) NOT NULL DEFAULT 'oraculista',
        ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}';
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS sc_categoria_idx
        ON specialist_candidates (categoria)
        WHERE deleted_at IS NULL;
    `);

    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_job_applications_estado" AS ENUM (
          'novo', 'em_analise', 'aprovado', 'reprovado', 'arquivado'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS job_applications (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        categoria         VARCHAR(32)  NOT NULL DEFAULT 'outras_areas',
        nome_completo     VARCHAR(160) NOT NULL,
        email             VARCHAR(320) NOT NULL,
        whatsapp          VARCHAR(32)  NULL,
        cidade            VARCHAR(120) NULL,
        area_interesse    JSONB        NOT NULL DEFAULT '[]',
        cargo_desejado    VARCHAR(160) NULL,
        nivel             VARCHAR(64)  NULL,
        linkedin          VARCHAR(512) NULL,
        portfolio_site    VARCHAR(512) NULL,
        curriculo_url     VARCHAR(512) NULL,
        curriculo_nome    VARCHAR(255) NULL,
        apresentacao      TEXT         NULL,
        como_chegou       TEXT         NULL,
        payload           JSONB        NOT NULL DEFAULT '{}',
        meta              JSONB        NOT NULL DEFAULT '{}',
        estado            "enum_job_applications_estado" NOT NULL DEFAULT 'novo',
        chegou_em         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        decidida_em       TIMESTAMPTZ  NULL,
        razao             TEXT         NULL,
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        deleted_at        TIMESTAMPTZ  NULL
      );
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS ja_estado_idx
        ON job_applications (estado)
        WHERE deleted_at IS NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS ja_email_lower_idx
        ON job_applications (lower(email))
        WHERE deleted_at IS NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS ja_chegou_idx
        ON job_applications (chegou_em DESC)
        WHERE deleted_at IS NULL;
    `);
  },

  async down({ sequelize }) {
    await sequelize.query(`DROP TABLE IF EXISTS job_applications;`);
    await sequelize.query(`DROP TYPE IF EXISTS "enum_job_applications_estado";`);
    await sequelize.query(`
      ALTER TABLE specialist_candidates
        DROP COLUMN IF EXISTS categoria,
        DROP COLUMN IF EXISTS meta;
    `);
  },
};
