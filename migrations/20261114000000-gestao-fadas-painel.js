'use strict';

/**
 * Gestão Fadas, fatia Painel (Maturacao/29 seção 11): duas tabelas no PostgreSQL novo para o que o Painel lê e o front hoje guarda só no navegador.
 *  - `gf_agenda_admissoes`: política de admissão do turno por tarólogo e dia (`AgendaIntakeEvent`: aberta, fechada, "Se der", retorno).
 *    Só acrescenta: o evento vigente é o último do tarólogo no dia (`currentIntake`, agenda-intake-model.ts);
 *  - `gf_agenda_solicitacoes`: "cliente quer consulta" pedida pela taróloga (`AgendaConsultationRequest`), que a equipe resolve ao agendar.
 * O resto do Painel (reservas da fila geral, relógios, pagamentos sem agenda) usa as tabelas da Agenda, Consulta e Pagamentos.
 * Idempotente: CREATE ... IF NOT EXISTS. Os CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_agenda_admissoes (
  id VARCHAR(64) NOT NULL,
  id_tarologo VARCHAR(64) NOT NULL,
  data_operacional DATE NOT NULL,
  modo VARCHAR(12) NOT NULL,
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  item JSONB NOT NULL,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_agenda_admissoes')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_agenda_admissoes_dia ON gf_agenda_admissoes (id_tarologo, data_operacional, ocorrido_em)',

  `CREATE TABLE IF NOT EXISTS gf_agenda_solicitacoes (
  id VARCHAR(64) NOT NULL,
  id_tarologo VARCHAR(64) NOT NULL,
  id_cliente VARCHAR(64) NOT NULL,
  data_operacional DATE NOT NULL,
  item JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_agenda_solicitacoes')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_agenda_solicitacoes_tarologo ON gf_agenda_solicitacoes (id_tarologo, data_operacional)',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
