'use strict';

/**
 * Alinha bancos EXISTENTES com o que os models declaram e nenhuma migração anterior garantia.
 * Tudo idempotente (checa antes) e sem apagar nem alterar linhas, exceto preencher NULL por 'PENDING'
 * em sessions.telecom_status, o mesmo valor que a migração 20260308140000 já aplicava.
 *
 *  1) sessions.telecom_status: NOT NULL DEFAULT 'PENDING' (o model sempre exigiu; a migração deixava nulável).
 *  2) Índices de sessions que o model declara sobre colunas criadas por migração (telecom_provider, telecom_status).
 *  3) CHECKs que a migração criou com CREATE TABLE IF NOT EXISTS e que bancos criados antes pelo sync não têm.
 *     Só são criados se nenhuma linha existente os violar (senão ficam de fora, com NOTICE).
 *  4) Colunas de ENUM do RBAC criadas pelo sync com tipo `enum_<tabela>_<coluna>` passam a usar os tipos
 *     `enum_access_permission_level` / `enum_staff_status` das migrações (mesmos valores; cast via texto).
 */
const CHECKS = [
  ['specialists', 'specialists_registration_approval_status_chk', "registration_approval_status IN ('PENDING', 'APPROVED', 'REJECTED')"],
  ['specialist_schedules', 'specialist_schedules_day_of_week_range', 'day_of_week >= 0 AND day_of_week <= 6'],
  ['specialist_schedules', 'specialist_schedules_time_order', 'end_time > start_time'],
  ['specialist_status_logs', 'specialist_status_logs_status_not_empty', 'length(trim(new_status)) > 0'],
  ['specialist_status_logs', 'specialist_status_logs_no_self_transition', 'previous_status IS NULL OR previous_status IS DISTINCT FROM new_status'],
  ['pending_deliveries', 'pending_deliveries_status_chk', "status IN ('PENDING', 'SENT', 'FAILED')"],
];

// [tabela, coluna, tipo novo (migração), valores, default]
const ENUMS = [
  ['access_permissions', 'nivel', 'enum_access_permission_level', ['baixo', 'medio', 'alto', 'critico'], 'baixo'],
  ['staff_profiles', 'staff_status', 'enum_staff_status', ['ativo', 'pendente', 'expirado', 'suspenso', 'desativado', 'bloqueado'], 'ativo'],
];

module.exports = {
  async up({ sequelize }) {
    const q = (sql) => sequelize.query(sql);

    await q(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'telecom_status') THEN
          UPDATE sessions SET telecom_status = 'PENDING' WHERE telecom_status IS NULL OR trim(telecom_status::text) = '';
          ALTER TABLE sessions ALTER COLUMN telecom_status SET DEFAULT 'PENDING';
          ALTER TABLE sessions ALTER COLUMN telecom_status SET NOT NULL;
        END IF;
      END $$;
    `);

    await q(`CREATE INDEX IF NOT EXISTS sessions_telecom_provider ON sessions (telecom_provider);`);
    await q(`CREATE INDEX IF NOT EXISTS sessions_telecom_status ON sessions (telecom_status);`);

    for (const [tabela, nome, cond] of CHECKS) {
      await q(`
        DO $$ BEGIN
          IF to_regclass('public.${tabela}') IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${nome}' AND conrelid = to_regclass('public.${tabela}')) THEN
            IF EXISTS (SELECT 1 FROM ${tabela} WHERE (${cond}) IS FALSE) THEN
              RAISE NOTICE 'CHECK % não criado: há linhas existentes que o violam', '${nome}';
            ELSE
              ALTER TABLE ${tabela} ADD CONSTRAINT ${nome} CHECK (${cond});
            END IF;
          END IF;
        END $$;
      `);
    }

    for (const [tabela, coluna, tipo, valores, padrao] of ENUMS) {
      const lista = valores.map((v) => `'${v}'`).join(', ');
      await q(`
        DO $$
        DECLARE atual text;
        BEGIN
          SELECT udt_name INTO atual FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = '${tabela}' AND column_name = '${coluna}';
          IF atual IS NULL OR atual = '${tipo}' THEN RETURN; END IF;
          BEGIN
            CREATE TYPE "${tipo}" AS ENUM (${lista});
          EXCEPTION WHEN duplicate_object THEN NULL;
          END;
          ALTER TABLE ${tabela} ALTER COLUMN ${coluna} DROP DEFAULT;
          ALTER TABLE ${tabela} ALTER COLUMN ${coluna} TYPE "${tipo}" USING ${coluna}::text::"${tipo}";
          ALTER TABLE ${tabela} ALTER COLUMN ${coluna} SET DEFAULT '${padrao}';
          BEGIN
            EXECUTE format('DROP TYPE %I', atual);
          EXCEPTION WHEN dependent_objects_still_exist THEN NULL;
          END;
        END $$;
      `);
    }
  },

  async down() {
    /* No-op: alinhamento estrutural, sem reversão segura. */
  },
};
