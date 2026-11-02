'use strict';

/**
 * Gestão Fadas, fatia Migração por planilha (Maturacao/55): uma tabela no PostgreSQL novo. NADA no MySQL legado.
 *  - `gf_migracao_historicos`: o histórico de migração de cada cliente (o `ClientMigrationHistory` do front em `item`), SOMENTE ACRESCENTA.
 *    Cada linha é uma revisão (`seq` 1, 2, ...); a última é a vigente. `source_key` (texto do front, pode ser longo) com `source_hash` (sha256) único por cliente (idempotência). UPDATE e DELETE são
 *    barrados por gatilho (a trilha nunca é reescrita). Colunas indexáveis: corte, crédito, débito, cobrar o débito, pós-pago.
 * Idempotente: CREATE ... IF NOT EXISTS. As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_migracao_historicos (
  id VARCHAR(64) NOT NULL,
  id_cliente VARCHAR(10) NOT NULL,
  seq INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  source_hash VARCHAR(64) NOT NULL,
  batch_id VARCHAR(160) NOT NULL,
  corte_em VARCHAR(40) NOT NULL,
  credito_centavos BIGINT NOT NULL,
  debito_centavos BIGINT NOT NULL,
  cobrar_debito BOOLEAN NOT NULL,
  pos_pago BOOLEAN NOT NULL,
  aprovado_em TIMESTAMPTZ NOT NULL,
  item JSONB NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_migracao_historicos')}
)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_migracao_historicos_seq ON gf_migracao_historicos (id_cliente, seq)',
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_migracao_historicos_source ON gf_migracao_historicos (id_cliente, source_hash)',
  'CREATE INDEX IF NOT EXISTS gf_migracao_historicos_lote ON gf_migracao_historicos (batch_id)',
  `CREATE OR REPLACE FUNCTION gf_migracao_historicos_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gf_migracao_historicos so acrescenta: % nao e permitido', TG_OP;
END;
$$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS gf_migracao_historicos_imutavel ON gf_migracao_historicos',
  `CREATE TRIGGER gf_migracao_historicos_imutavel BEFORE UPDATE OR DELETE ON gf_migracao_historicos
  FOR EACH ROW EXECUTE FUNCTION gf_migracao_historicos_imutavel()`,
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
