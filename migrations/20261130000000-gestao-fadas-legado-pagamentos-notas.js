'use strict';

/**
 * Gestão Fadas, espelho de pagamento informado e de nota da ficha no legado (Maturacao/45 e 46). SÓ colunas de vínculo no PostgreSQL novo; nada no MySQL.
 *  - `gf_pagamentos` e `gf_clientes_notas`: `legado_id` (id da linha criada no legado: `idPagtoInformado` / `obs_liberacao_consulta.id`), `legado_estado`
 *    (nao_espelhada, espelhada, recusada, desatualizada, erro), `legado_detalhe` (motivo curto, sem segredo) e `legado_atualizado_em`.
 * Idempotente. Os CHECKs vêm de `CHECKS_ESPELHO` (src/gestao-fadas/novo/esquema-checks.js).
 */

const { CHECKS_ESPELHO } = require('../src/gestao-fadas/novo/esquema-checks');

const TABELAS = ['gf_pagamentos', 'gf_clientes_notas'];

// Literais (não gerados em laço): o comparador estrito lê este arquivo como TEXTO.
const DDL = [
  'ALTER TABLE gf_pagamentos ADD COLUMN IF NOT EXISTS legado_id VARCHAR(10)',
  "ALTER TABLE gf_pagamentos ADD COLUMN IF NOT EXISTS legado_estado VARCHAR(16) NOT NULL DEFAULT 'nao_espelhada'",
  'ALTER TABLE gf_pagamentos ADD COLUMN IF NOT EXISTS legado_detalhe VARCHAR(300)',
  'ALTER TABLE gf_pagamentos ADD COLUMN IF NOT EXISTS legado_atualizado_em TIMESTAMPTZ',
  'ALTER TABLE gf_clientes_notas ADD COLUMN IF NOT EXISTS legado_id VARCHAR(10)',
  "ALTER TABLE gf_clientes_notas ADD COLUMN IF NOT EXISTS legado_estado VARCHAR(16) NOT NULL DEFAULT 'nao_espelhada'",
  'ALTER TABLE gf_clientes_notas ADD COLUMN IF NOT EXISTS legado_detalhe VARCHAR(300)',
  'ALTER TABLE gf_clientes_notas ADD COLUMN IF NOT EXISTS legado_atualizado_em TIMESTAMPTZ',
  ...TABELAS.flatMap((t) => CHECKS_ESPELHO[t].flatMap(([nome, expr]) => [`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${nome}`, `ALTER TABLE ${t} ADD CONSTRAINT ${nome} CHECK (${expr})`])),
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
