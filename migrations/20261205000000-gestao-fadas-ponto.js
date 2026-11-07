'use strict';

/**
 * Gestão Fadas, fatia Ponto e escala da equipe (v702 da Nice): tabelas do PostgreSQL novo. NADA no MySQL legado. Aditiva e idempotente.
 *  - `gf_ponto_turnos`: um turno da atendente (entrada, pausas, sinais perdidos, saída). `conteudo` guarda o turno exatamente como o front o lê;
 *    `ultimo_em` (saída ou último sinal) existe só para a consulta "Equipe no dia" não varrer o JSON.
 *  - `gf_ponto_escalas`: a escala da atendente (padrão semanal com vigência + exceções por data), com revisão para o 409.
 *  - `gf_ponto_eventos`: diário de ações confirmadas do Gestão por atendente (recepção `ingest`), SÓ ACRESCENTA (gatilho barra UPDATE e DELETE).
 * As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_ponto_turnos (
  id VARCHAR(160) NOT NULL,
  id_conta VARCHAR(160) NOT NULL,
  data_operacional DATE NOT NULL,
  iniciado_em TIMESTAMPTZ NOT NULL,
  ultimo_em TIMESTAMPTZ NOT NULL,
  conteudo JSONB NOT NULL,
  revisao INTEGER NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
${ck('gf_ponto_turnos')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_ponto_turnos_conta_inicio ON gf_ponto_turnos (id_conta, iniciado_em)',
  'CREATE INDEX IF NOT EXISTS gf_ponto_turnos_dia ON gf_ponto_turnos (data_operacional)',

  `CREATE TABLE IF NOT EXISTS gf_ponto_escalas (
  id_conta VARCHAR(160) NOT NULL,
  conteudo JSONB NOT NULL,
  revisao INTEGER NOT NULL DEFAULT 1,
  atualizado_por VARCHAR(160) NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_conta),
${ck('gf_ponto_escalas')}
)`,

  `CREATE TABLE IF NOT EXISTS gf_ponto_eventos (
  id VARCHAR(300) NOT NULL,
  id_conta VARCHAR(160) NOT NULL,
  ocorreu_em TIMESTAMPTZ NOT NULL,
  recebido_em TIMESTAMPTZ NOT NULL,
  conteudo JSONB NOT NULL,
  PRIMARY KEY (id),
${ck('gf_ponto_eventos')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_ponto_eventos_conta_hora ON gf_ponto_eventos (id_conta, ocorreu_em)',
  `CREATE OR REPLACE FUNCTION gf_ponto_eventos_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gf_ponto_eventos so acrescenta: % nao e permitido', TG_OP;
END;
$$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS gf_ponto_eventos_imutavel ON gf_ponto_eventos',
  `CREATE TRIGGER gf_ponto_eventos_imutavel BEFORE UPDATE OR DELETE ON gf_ponto_eventos
  FOR EACH ROW EXECUTE FUNCTION gf_ponto_eventos_imutavel()`,
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
  // Aditiva: não há reversão automática (nunca apaga dado de ponto).
  async down() {},
};
