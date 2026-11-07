'use strict';

/**
 * Banco novo (PostgreSQL da A), fatia Contas, v706 da Nice: convite de acesso e permissão "Ver minutagem total" em `gf_contas_ext`.
 *  - Convite: UM por conta (gerar outro invalida o anterior). Guarda só a impressão SHA-256 do token (nunca o token nem o link).
 *  - `acesso_pendente`: conta criada por convite que ainda não definiu a senha (a senha de `users` é um hash aleatório inutilizável).
 *  - `ver_minutagem` e `permissoes_trilha`: a permissão individual e a trilha de quem alterou (só a administradora altera).
 * Idempotente. Nada no MySQL legado.
 */

const DDL = [
  `ALTER TABLE gf_contas_ext
  ADD COLUMN IF NOT EXISTS acesso_pendente BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS convite_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS convite_tipo VARCHAR(16),
  ADD COLUMN IF NOT EXISTS convite_email VARCHAR(320),
  ADD COLUMN IF NOT EXISTS convite_papel VARCHAR(16),
  ADD COLUMN IF NOT EXISTS convite_emitido TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS convite_expira TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS convite_usado TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS convite_revogado TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ver_minutagem BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS permissoes_trilha JSONB NOT NULL DEFAULT '[]'::jsonb`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_contas_ext_convite_hash ON gf_contas_ext (convite_hash) WHERE convite_hash IS NOT NULL',
  `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_contas_ext_convite') THEN
    ALTER TABLE gf_contas_ext ADD CONSTRAINT chk_contas_ext_convite CHECK (
      (convite_hash IS NULL AND convite_tipo IS NULL AND convite_emitido IS NULL AND convite_expira IS NULL)
      OR (convite_hash ~ '^[0-9a-f]{64}$' AND convite_tipo IN ('first-access', 'reset-password') AND convite_emitido IS NOT NULL AND convite_expira > convite_emitido));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_contas_ext_trilha') THEN
    ALTER TABLE gf_contas_ext ADD CONSTRAINT chk_contas_ext_trilha CHECK (jsonb_typeof(permissoes_trilha) = 'array');
  END IF;
END $$`,
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
