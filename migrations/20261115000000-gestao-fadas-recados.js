'use strict';

/**
 * Banco novo (PostgreSQL da A), fatia Recados (Maturacao/30). NADA no MySQL legado (a tabela legada `recado`
 * é PROIBIDA para Recados, decisão do plano 26):
 *  - `gf_recados`: um recado (ou resposta) por linha, com o `OperationalNote` como o front o lê em `item` jsonb, versão de conteúdo e a trilha
 *    de revisões embutida (só cresce);
 *  - `gf_recados_pessoais`: o que é PESSOAL de cada conta sobre um recado (lido, fixado, prioridade, arquivado), fora da versão do conteúdo;
 * Idempotente: CREATE ... IF NOT EXISTS. As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_recados (
  id VARCHAR(64) NOT NULL,
  id_tarologo VARCHAR(64) NOT NULL,
  origem VARCHAR(12) NOT NULL,
  id_ator VARCHAR(64),
  id_resposta_a VARCHAR(64),
  excluido BOOLEAN NOT NULL DEFAULT false,
  item JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_recados')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_recados_tarologo ON gf_recados (id_tarologo)',
  'CREATE INDEX IF NOT EXISTS gf_recados_resposta ON gf_recados (id_resposta_a)',
  'CREATE INDEX IF NOT EXISTS gf_recados_ator ON gf_recados (id_ator)',

  `CREATE TABLE IF NOT EXISTS gf_recados_pessoais (
  id_recado VARCHAR(64) NOT NULL,
  id_conta VARCHAR(64) NOT NULL,
  lido_em TIMESTAMPTZ,
  lido_por VARCHAR(200),
  lido_versao TEXT,
  fixado_em TIMESTAMPTZ,
  prioridade_em TIMESTAMPTZ,
  arquivado JSONB,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id_recado, id_conta),
${ck('gf_recados_pessoais')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_recados_pessoais_conta ON gf_recados_pessoais (id_conta)',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
