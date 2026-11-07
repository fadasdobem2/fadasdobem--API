'use strict';

/**
 * Gestão Fadas, Agenda v706 da Nice (Maturacao/57): contatos que ainda não são cliente (código IL) e agendamentos/pedidos "de contato".
 *  - `gf_agenda_contatos`: o contato (lead) durável, com o histórico. Um registro com versão; o código de exibição é do servidor.
 *  - `gf_agenda`: `id_cliente` passa a aceitar NULO (um agendamento tem cliente OU contato) e ganha `id_contato`.
 *  - `gf_agenda_solicitacoes`: o mesmo (`id_cliente` nulo, `id_contato`).
 * Só o banco NOVO. Idempotente: IF NOT EXISTS / DROP NOT NULL repetido não muda nada. Os CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_agenda_contatos (
  id VARCHAR(64) NOT NULL,
  codigo VARCHAR(16),
  item JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_agenda_contatos')}
)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_agenda_contatos_codigo ON gf_agenda_contatos (codigo)',
  'ALTER TABLE gf_agenda ALTER COLUMN id_cliente DROP NOT NULL',
  'ALTER TABLE gf_agenda ADD COLUMN IF NOT EXISTS id_contato VARCHAR(64)',
  'CREATE INDEX IF NOT EXISTS gf_agenda_contato ON gf_agenda (id_contato)',
  'ALTER TABLE gf_agenda_solicitacoes ALTER COLUMN id_cliente DROP NOT NULL',
  'ALTER TABLE gf_agenda_solicitacoes ADD COLUMN IF NOT EXISTS id_contato VARCHAR(64)',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
