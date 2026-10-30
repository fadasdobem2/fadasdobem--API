'use strict';

/**
 * Gestão Fadas, fatia Estado financeiro (Maturacao/43): três tabelas no PostgreSQL novo. NADA no MySQL legado.
 *  - `gf_motivos_financeiros`: o catálogo de motivos do extrato, UMA linha por motivo com TODAS as versões em `item` (`{ versions: [...] }`, só cresce);
 *    `version` = número da última versão (revisão otimista);
 *  - `gf_adicionais_itens`: o armazém de Adicionais do repasse, uma linha por categoria, regra recorrente ou ocorrência (`tipo`), registro do front em `item`;
 *  - `gf_log_operacional`: a trilha operacional (Logs de Configurações), só acrescenta; um evento por linha, como o navegador o derivou.
 * Idempotente: CREATE ... IF NOT EXISTS. As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_motivos_financeiros (
  id VARCHAR(64) NOT NULL,
  item JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_motivos_financeiros')}
)`,
  `CREATE TABLE IF NOT EXISTS gf_adicionais_itens (
  chave VARCHAR(200) NOT NULL,
  tipo VARCHAR(10) NOT NULL,
  item JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (chave),
${ck('gf_adicionais_itens')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_adicionais_tipo ON gf_adicionais_itens (tipo, criado_em)',
  `CREATE TABLE IF NOT EXISTS gf_log_operacional (
  id VARCHAR(200) NOT NULL,
  categoria VARCHAR(20) NOT NULL,
  ocorrido_em TIMESTAMPTZ NULL,
  item JSONB NOT NULL,
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  registrado_por VARCHAR(120) NOT NULL,
  conta_id VARCHAR(64) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_log_operacional')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_log_operacional_quando ON gf_log_operacional (ocorrido_em, registrado_em)',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
