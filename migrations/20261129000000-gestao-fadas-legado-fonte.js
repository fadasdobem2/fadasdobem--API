'use strict';

/**
 * Gestão Fadas, legado como fonte (Maturacao/46): UMA tabela no PostgreSQL novo, nada no MySQL do legado.
 *  - `gf_legado_intencoes`: o registro de cada escrita no legado feita ANTES do commit do Postgres (cliente, tarólogo, consulta): o que o legado
 *    tinha (`antes`) e o que recebeu (`depois`, só colunas do legado), o estado (iniciada, concluida, revertida, divergente) e as recusas da trava de
 *    banco (`GF_LEGADO_ESCRITA_BANCOS`). É o que a reconciliação usa quando o processo cai entre a escrita no legado e o commit do Postgres.
 * Idempotente. Os CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_legado_intencoes (
  id VARCHAR(64) NOT NULL,
  entidade VARCHAR(16) NOT NULL,
  entidade_id VARCHAR(64) NOT NULL,
  escopo VARCHAR(80),
  operation_key VARCHAR(128),
  legado_id VARCHAR(20),
  antes JSONB,
  depois JSONB,
  estado VARCHAR(12) NOT NULL,
  detalhe VARCHAR(300),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
${ck('gf_legado_intencoes')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_legado_intencoes_estado ON gf_legado_intencoes (estado, atualizado_em)',
  'CREATE INDEX IF NOT EXISTS gf_legado_intencoes_entidade ON gf_legado_intencoes (entidade, entidade_id)',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
