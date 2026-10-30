'use strict';

/**
 * RBAC granular — Papéis · Funções · Cargos · Setores · Exceções (spec g33c).
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_access_permission_level" AS ENUM ('baixo', 'medio', 'alto', 'critico');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE "enum_staff_status" AS ENUM (
          'ativo', 'pendente', 'expirado', 'suspenso', 'desativado', 'bloqueado'
        );
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS access_permissions (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chave        VARCHAR(120) NOT NULL,
        rotulo       VARCHAR(200) NOT NULL,
        descricao    TEXT NULL,
        area         VARCHAR(64)  NOT NULL,
        nivel        "enum_access_permission_level" NOT NULL DEFAULT 'baixo',
        ativo        BOOLEAN NOT NULL DEFAULT TRUE,
        custom       BOOLEAN NOT NULL DEFAULT FALSE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at   TIMESTAMPTZ NULL
      );
    `);

    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS access_permissions_chave_active_uidx
        ON access_permissions (chave)
        WHERE deleted_at IS NULL;
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS access_roles (
        id           VARCHAR(64) PRIMARY KEY,
        nome         VARCHAR(160) NOT NULL,
        descricao    TEXT NULL,
        icone        VARCHAR(64) NOT NULL DEFAULT 'ph-user-gear',
        cor_gradient VARCHAR(255) NULL,
        all_access   BOOLEAN NOT NULL DEFAULT FALSE,
        sistema      BOOLEAN NOT NULL DEFAULT FALSE,
        ativo        BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at   TIMESTAMPTZ NULL
      );
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS access_role_permissions (
        role_id        VARCHAR(64) NOT NULL REFERENCES access_roles(id) ON DELETE CASCADE,
        permission_id  UUID NOT NULL REFERENCES access_permissions(id) ON DELETE CASCADE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (role_id, permission_id)
      );
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS access_departments (
        id           VARCHAR(64) PRIMARY KEY,
        nome         VARCHAR(160) NOT NULL,
        descricao    TEXT NULL,
        icone        VARCHAR(64) NOT NULL DEFAULT 'ph-squares-four',
        cor          VARCHAR(32) NOT NULL DEFAULT 'v-blue',
        ativo        BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at   TIMESTAMPTZ NULL
      );
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS access_department_permissions (
        department_id  VARCHAR(64) NOT NULL REFERENCES access_departments(id) ON DELETE CASCADE,
        permission_id  UUID NOT NULL REFERENCES access_permissions(id) ON DELETE CASCADE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (department_id, permission_id)
      );
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS access_job_titles (
        id              VARCHAR(64) PRIMARY KEY,
        nome            VARCHAR(160) NOT NULL,
        descricao       TEXT NULL,
        default_role_id VARCHAR(64) NOT NULL REFERENCES access_roles(id),
        icone           VARCHAR(64) NOT NULL DEFAULT 'ph-identification-badge',
        cor             VARCHAR(32) NOT NULL DEFAULT 'v-gold',
        ativo           BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ NULL
      );
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS access_user_roles (
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id    VARCHAR(64) NOT NULL REFERENCES access_roles(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, role_id)
      );
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS access_user_exceptions (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission_id UUID NOT NULL REFERENCES access_permissions(id) ON DELETE CASCADE,
        granted       BOOLEAN NOT NULL,
        motivo        TEXT NOT NULL,
        author_id     UUID NOT NULL REFERENCES users(id),
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at    TIMESTAMPTZ NULL
      );
    `);

    await sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS access_user_exceptions_user_perm_uidx
        ON access_user_exceptions (user_id, permission_id)
        WHERE deleted_at IS NULL;
    `);

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS access_staff_invites (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email           VARCHAR(320) NOT NULL,
        token_hash      VARCHAR(128) NOT NULL,
        user_id         UUID NULL REFERENCES users(id) ON DELETE SET NULL,
        department_id   VARCHAR(64) NULL REFERENCES access_departments(id),
        job_title_id    VARCHAR(64) NULL REFERENCES access_job_titles(id),
        role_ids        JSONB NOT NULL DEFAULT '[]',
        expires_at      TIMESTAMPTZ NOT NULL,
        accepted_at     TIMESTAMPTZ NULL,
        invited_by_id   UUID NOT NULL REFERENCES users(id),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS access_staff_invites_email_idx
        ON access_staff_invites (lower(email));
    `);

    await sequelize.query(`
      ALTER TABLE staff_profiles
        ADD COLUMN IF NOT EXISTS department_id VARCHAR(64) NULL REFERENCES access_departments(id),
        ADD COLUMN IF NOT EXISTS job_title_id VARCHAR(64) NULL REFERENCES access_job_titles(id),
        ADD COLUMN IF NOT EXISTS staff_status "enum_staff_status" NOT NULL DEFAULT 'ativo',
        ADD COLUMN IF NOT EXISTS avatar_gradient VARCHAR(255) NULL,
        ADD COLUMN IF NOT EXISTS avatar_initials VARCHAR(8) NULL,
        ADD COLUMN IF NOT EXISTS vinculo VARCHAR(64) NULL,
        ADD COLUMN IF NOT EXISTS personal_email VARCHAR(320) NULL,
        ADD COLUMN IF NOT EXISTS cpf VARCHAR(20) NULL,
        ADD COLUMN IF NOT EXISTS birth_date DATE NULL,
        ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(32) NULL,
        ADD COLUMN IF NOT EXISTS whatsapp2 VARCHAR(32) NULL,
        ADD COLUMN IF NOT EXISTS address_json JSONB NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS payment_json JSONB NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS first_login_at TIMESTAMPTZ NULL;
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS staff_profiles_department_idx
        ON staff_profiles (department_id)
        WHERE deleted_at IS NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS staff_profiles_status_idx
        ON staff_profiles (staff_status)
        WHERE deleted_at IS NULL;
    `);
  },

  async down({ sequelize }) {
    await sequelize.query(`
      ALTER TABLE staff_profiles
        DROP COLUMN IF EXISTS department_id,
        DROP COLUMN IF EXISTS job_title_id,
        DROP COLUMN IF EXISTS staff_status,
        DROP COLUMN IF EXISTS avatar_gradient,
        DROP COLUMN IF EXISTS avatar_initials,
        DROP COLUMN IF EXISTS vinculo,
        DROP COLUMN IF EXISTS personal_email,
        DROP COLUMN IF EXISTS cpf,
        DROP COLUMN IF EXISTS birth_date,
        DROP COLUMN IF EXISTS whatsapp,
        DROP COLUMN IF EXISTS whatsapp2,
        DROP COLUMN IF EXISTS address_json,
        DROP COLUMN IF EXISTS payment_json,
        DROP COLUMN IF EXISTS invited_at,
        DROP COLUMN IF EXISTS first_login_at;
    `);
    await sequelize.query(`DROP TABLE IF EXISTS access_staff_invites;`);
    await sequelize.query(`DROP TABLE IF EXISTS access_user_exceptions;`);
    await sequelize.query(`DROP TABLE IF EXISTS access_user_roles;`);
    await sequelize.query(`DROP TABLE IF EXISTS access_job_titles;`);
    await sequelize.query(`DROP TABLE IF EXISTS access_department_permissions;`);
    await sequelize.query(`DROP TABLE IF EXISTS access_departments;`);
    await sequelize.query(`DROP TABLE IF EXISTS access_role_permissions;`);
    await sequelize.query(`DROP TABLE IF EXISTS access_roles;`);
    await sequelize.query(`DROP TABLE IF EXISTS access_permissions;`);
    await sequelize.query(`DROP TYPE IF EXISTS "enum_staff_status";`);
    await sequelize.query(`DROP TYPE IF EXISTS "enum_access_permission_level";`);
  },
};
