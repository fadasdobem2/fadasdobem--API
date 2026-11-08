'use strict';

/**
 * Gestão Fadas, Lilly v710 (docs/banco/22 da Nice): PostgreSQL novo. NADA no MySQL legado.
 *  - `gf_tarologos_ext.name_article` ('o' | 'a' | NULL): tratamento explícito do profissional ("o tarólogo", "a taróloga"). NUNCA preenchida em massa nem
 *    deduzida do nome (o campo NULL é neutro). O CHECK vem de src/gestao-fadas/novo/esquema-checks.js.
 * Idempotente.
 */

const { CHECKS_LILLY_V710 } = require('../src/gestao-fadas/novo/esquema-checks');

const DDL = [
  'ALTER TABLE gf_tarologos_ext ADD COLUMN IF NOT EXISTS name_article VARCHAR(1)',
  ...CHECKS_LILLY_V710.gf_tarologos_ext
    .flatMap(([nome, expr]) => [`ALTER TABLE gf_tarologos_ext DROP CONSTRAINT IF EXISTS ${nome}`, `ALTER TABLE gf_tarologos_ext ADD CONSTRAINT ${nome} CHECK (${expr})`]),
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
