'use strict';

/**
 * Gestão Fadas, fatia Divergências (Maturacao/31): uma tabela no PostgreSQL novo. NADA no MySQL legado.
 *  - `gf_divergencias`: uma divergência por linha (o `Divergence` do front em `item`, com histórico e comentários embutidos, que só crescem),
 *    revisão otimista (`version`) e colunas indexáveis (tipo, área, situação, cliente, tarólogo, repórter, consulta, pagamento, excluída).
 * Idempotente: CREATE ... IF NOT EXISTS. As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_divergencias (
  id VARCHAR(64) NOT NULL,
  tipo VARCHAR(12) NOT NULL,
  area VARCHAR(12) NOT NULL,
  situacao VARCHAR(16) NOT NULL,
  id_cliente VARCHAR(10),
  id_tarologo VARCHAR(64),
  id_reportador VARCHAR(64),
  id_consulta VARCHAR(64),
  id_pagamento VARCHAR(64),
  excluida BOOLEAN NOT NULL DEFAULT FALSE,
  item JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_divergencias')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_divergencias_situacao ON gf_divergencias (situacao, excluida)',
  'CREATE INDEX IF NOT EXISTS gf_divergencias_cliente ON gf_divergencias (id_cliente)',
  'CREATE INDEX IF NOT EXISTS gf_divergencias_reportador ON gf_divergencias (id_reportador)',
  'CREATE INDEX IF NOT EXISTS gf_divergencias_consulta ON gf_divergencias (id_consulta)',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
