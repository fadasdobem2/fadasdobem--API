'use strict';

/**
 * Gestão Fadas, fatia Ficha da cliente (Maturacao/36): duas tabelas no PostgreSQL novo. NADA no MySQL legado.
 *  - `gf_clientes_orientacoes`: a ORIENTAÇÃO FINANCEIRA da supervisora de cada cliente (o `ClientFinancialGuidance` do front em `item`: motivo,
 *    autorização, histórico que só cresce). `revisao` = `revision` do registro (concorrência otimista); `ativa` e `pendente` ficam em coluna
 *    para a fila de Pendências.
 *  - `gf_clientes_notas`: as OBSERVAÇÕES da cliente (o `ClientNote` do front em `item`, com o histórico de revisões), `version` otimista.
 * Idempotente: CREATE ... IF NOT EXISTS. As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_clientes_orientacoes (
  id_cliente VARCHAR(10) NOT NULL,
  revisao INTEGER NOT NULL DEFAULT 1,
  ativa BOOLEAN NOT NULL,
  pendente BOOLEAN NOT NULL,
  item JSONB NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id_cliente),
${ck('gf_clientes_orientacoes')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_clientes_orientacoes_pendente ON gf_clientes_orientacoes (ativa, pendente)',
  `CREATE TABLE IF NOT EXISTS gf_clientes_notas (
  id VARCHAR(64) NOT NULL,
  id_cliente VARCHAR(10) NOT NULL,
  item JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_clientes_notas')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_clientes_notas_cliente ON gf_clientes_notas (id_cliente, criado_em)',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
