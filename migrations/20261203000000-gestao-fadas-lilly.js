'use strict';

/**
 * Gestão Fadas, fatia Lilly (Maturacao/59): tabelas do PostgreSQL novo. NADA no MySQL legado.
 *  - `gf_lilly_vinculos`: cliente x contato Umbler x conversa (único por contato+conversa).
 *  - `gf_lilly_eventos`: eventos JÁ RESOLVIDOS e verificados (a "prova", D10). SOMENTE ACRESCENTA (gatilho barra UPDATE e DELETE).
 *  - `gf_lilly_acoes`: guarda de idempotência e conciliação das ações (chave interna + chave original + hash estável do corpo).
 *  - `gf_lilly_notas_horario`, `gf_lilly_pagamento_refs`, `gf_lilly_cotacoes`, `gf_lilly_avisos`.
 * Idempotente: CREATE ... IF NOT EXISTS. As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_lilly_vinculos (
  id VARCHAR(64) NOT NULL,
  id_cliente VARCHAR(10) NOT NULL,
  umbler_contact_id VARCHAR(160) NOT NULL,
  umbler_conversation_id VARCHAR(160) NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  attribution JSONB,
  first_contact BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
${ck('gf_lilly_vinculos')}
)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_lilly_vinculos_contato_conversa ON gf_lilly_vinculos (umbler_contact_id, umbler_conversation_id)',
  'CREATE INDEX IF NOT EXISTS gf_lilly_vinculos_cliente ON gf_lilly_vinculos (id_cliente)',
  'CREATE INDEX IF NOT EXISTS gf_lilly_vinculos_conversa ON gf_lilly_vinculos (umbler_conversation_id)',

  `CREATE TABLE IF NOT EXISTS gf_lilly_eventos (
  id VARCHAR(200) NOT NULL,
  source VARCHAR(10) NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  conversation_id VARCHAR(160),
  contact_id VARCHAR(160),
  message_id VARCHAR(160),
  actor VARCHAR(12) NOT NULL,
  internal BOOLEAN NOT NULL,
  id_cliente VARCHAR(10),
  tarologist_id VARCHAR(64),
  text TEXT,
  data JSONB NOT NULL,
  provider_meta JSONB,
  staff_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  staff_id VARCHAR(160),
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
${ck('gf_lilly_eventos')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_lilly_eventos_conversa ON gf_lilly_eventos (conversation_id, at)',
  'CREATE INDEX IF NOT EXISTS gf_lilly_eventos_cliente ON gf_lilly_eventos (id_cliente)',
  `CREATE OR REPLACE FUNCTION gf_lilly_eventos_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gf_lilly_eventos so acrescenta: % nao e permitido', TG_OP;
END;
$$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS gf_lilly_eventos_imutavel ON gf_lilly_eventos',
  `CREATE TRIGGER gf_lilly_eventos_imutavel BEFORE UPDATE OR DELETE ON gf_lilly_eventos
  FOR EACH ROW EXECUTE FUNCTION gf_lilly_eventos_imutavel()`,

  `CREATE TABLE IF NOT EXISTS gf_lilly_acoes (
  chave_interna VARCHAR(200) NOT NULL,
  chave_original TEXT NOT NULL,
  hash_corpo VARCHAR(64) NOT NULL,
  kind VARCHAR(48) NOT NULL,
  estado VARCHAR(16) NOT NULL,
  resultado JSONB,
  evento_origem VARCHAR(200),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chave_interna),
${ck('gf_lilly_acoes')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_lilly_acoes_estado ON gf_lilly_acoes (estado, atualizado_em)',

  `CREATE TABLE IF NOT EXISTS gf_lilly_notas_horario (
  id VARCHAR(64) NOT NULL,
  tarologist_id VARCHAR(64) NOT NULL,
  data_operacional DATE NOT NULL,
  schedule_id VARCHAR(64),
  expected_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  status VARCHAR(10) NOT NULL,
  texto TEXT NOT NULL,
  conversation_id VARCHAR(160),
  message_id VARCHAR(160),
  at TIMESTAMPTZ NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
${ck('gf_lilly_notas_horario')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_lilly_notas_horario_dia ON gf_lilly_notas_horario (tarologist_id, data_operacional)',

  `CREATE TABLE IF NOT EXISTS gf_lilly_pagamento_refs (
  payment_id VARCHAR(64) NOT NULL,
  reference VARCHAR(200),
  mp_payment_id VARCHAR(100),
  external_transaction_id VARCHAR(200),
  end_to_end_id VARCHAR(100),
  source_event_id VARCHAR(200),
  proposal_id VARCHAR(200),
  authorized_event_id VARCHAR(200),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (payment_id),
${ck('gf_lilly_pagamento_refs')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_lilly_refs_reference ON gf_lilly_pagamento_refs (reference)',
  'CREATE INDEX IF NOT EXISTS gf_lilly_refs_mp ON gf_lilly_pagamento_refs (mp_payment_id)',
  'CREATE INDEX IF NOT EXISTS gf_lilly_refs_externa ON gf_lilly_pagamento_refs (external_transaction_id)',
  'CREATE INDEX IF NOT EXISTS gf_lilly_refs_e2e ON gf_lilly_pagamento_refs (end_to_end_id)',
  'CREATE INDEX IF NOT EXISTS gf_lilly_refs_evento ON gf_lilly_pagamento_refs (source_event_id)',

  `CREATE TABLE IF NOT EXISTS gf_lilly_cotacoes (
  id VARCHAR(64) NOT NULL,
  conversation_id VARCHAR(160) NOT NULL,
  id_cliente VARCHAR(10),
  current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL,
  amount_centavos BIGINT NOT NULL,
  minutes INTEGER NOT NULL,
  PRIMARY KEY (id),
${ck('gf_lilly_cotacoes')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_lilly_cotacoes_conversa ON gf_lilly_cotacoes (conversation_id, created_at)',

  `CREATE TABLE IF NOT EXISTS gf_lilly_avisos (
  id VARCHAR(64) NOT NULL,
  conversation_id VARCHAR(160) NOT NULL,
  id_cliente VARCHAR(10),
  appointment_id VARCHAR(64),
  message_id VARCHAR(160),
  sent_at TIMESTAMPTZ NOT NULL,
  autor VARCHAR(120),
  PRIMARY KEY (id),
${ck('gf_lilly_avisos')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_lilly_avisos_conversa ON gf_lilly_avisos (conversation_id, sent_at)',
  'CREATE INDEX IF NOT EXISTS gf_lilly_avisos_agendamento ON gf_lilly_avisos (appointment_id)',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
