'use strict';

/**
 * Gestão Fadas, fatia Presença (Maturacao/28 seção 5.4, reconferida com o front): três tabelas no PostgreSQL novo.
 *  - `gf_presenca_estado`: a declaração de turno de cada tarólogo (Disponível, Em pausa, Offline), retorno, saída, janela confirmada
 *    e os carimbos de confirmação; `revisao` é o token de concorrência (sobe a cada mudança de estado, NÃO a cada batimento);
 *  - `gf_presenca_confirmacoes`: o pedido de confirmação 60+5 (uma linha por tarólogo; `limpa_em` preenchido = sem pedido, porque o
 *    executor do banco novo não faz DELETE);
 *  - `gf_presenca_historico`: o histórico de presença (ator, antes e depois), só se acrescenta; o "Sistema" do job também entra aqui.
 * Idempotente: CREATE ... IF NOT EXISTS. As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_presenca_estado (
  id_tarologo VARCHAR(64) NOT NULL,
  shift_status VARCHAR(12) NOT NULL,
  shift_exit VARCHAR(12),
  pause_reason VARCHAR(20),
  presence_date DATE,
  expected_return TIMESTAMPTZ,
  return_until TIMESTAMPTZ,
  return_forecast JSONB,
  shift_available_since TIMESTAMPTZ,
  presence_last_activity_at TIMESTAMPTZ,
  presence_confirmed_at TIMESTAMPTZ,
  presence_schedule_updated_at TIMESTAMPTZ,
  confirmed_period_date DATE,
  confirmed_period_start_at TIMESTAMPTZ,
  confirmed_period_end_at TIMESTAMPTZ,
  revisao INTEGER NOT NULL DEFAULT 1,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_tarologo),
${ck('gf_presenca_estado')}
)`,

  `CREATE TABLE IF NOT EXISTS gf_presenca_confirmacoes (
  id_tarologo VARCHAR(64) NOT NULL,
  reason VARCHAR(12) NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  deadline_at TIMESTAMPTZ,
  offline_at TIMESTAMPTZ,
  idle_timeout_ms BIGINT,
  limpa_em TIMESTAMPTZ,
  PRIMARY KEY (id_tarologo),
${ck('gf_presenca_confirmacoes')}
)`,

  `CREATE TABLE IF NOT EXISTS gf_presenca_historico (
  id VARCHAR(160) NOT NULL,
  id_tarologo VARCHAR(64) NOT NULL,
  ordem BIGINT NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  actor_name VARCHAR(200) NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  date DATE NOT NULL,
  antes TEXT NOT NULL,
  depois TEXT NOT NULL,
  operation_key VARCHAR(128),
  PRIMARY KEY (id),
${ck('gf_presenca_historico')}
)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_presenca_historico_ordem ON gf_presenca_historico (id_tarologo, ordem)',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
