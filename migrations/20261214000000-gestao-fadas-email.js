'use strict';

/**
 * Gestão Fadas, e-mails (v711 da Nice): tabelas do PostgreSQL novo. NADA no MySQL legado. Aditiva e idempotente.
 *  - `gf_email_config`: UMA linha (id = 1) com a configuração das 4 finalidades e das conexões (`conteudo`, sem segredo) e o texto CIFRADO
 *    do segredo de cada conexão (`segredos`, AES-256-GCM com a chave de GF_EMAIL_CHAVE_SEGREDO); `revisao` serve ao conflito otimista.
 *  - `gf_email_eventos`: recibos (aceito ou falhou) de teste e de convite; SÓ ACRESCENTA (gatilho barra UPDATE e DELETE). Nunca guarda mensagem,
 *    destinatário nem texto de erro do provedor.
 * As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks-email.js.
 */

const { CHECKS_EMAIL } = require('../src/gestao-fadas/novo/esquema-checks-email');

const ck = (tabela) => CHECKS_EMAIL[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_email_config (
  id SMALLINT NOT NULL,
  revisao INTEGER NOT NULL,
  conteudo JSONB NOT NULL,
  segredos JSONB NOT NULL,
  atualizado_por VARCHAR(160) NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
${ck('gf_email_config')}
)`,
  `CREATE TABLE IF NOT EXISTS gf_email_eventos (
  id VARCHAR(80) NOT NULL,
  ocorreu_em TIMESTAMPTZ NOT NULL,
  ator_id VARCHAR(160) NOT NULL,
  finalidade VARCHAR(16) NOT NULL,
  tipo VARCHAR(16) NOT NULL,
  conta_id VARCHAR(160),
  resultado VARCHAR(16) NOT NULL,
  codigo_erro VARCHAR(200),
  PRIMARY KEY (id),
${ck('gf_email_eventos')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_email_eventos_hora ON gf_email_eventos (ocorreu_em)',
  `CREATE OR REPLACE FUNCTION gf_email_eventos_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gf_email_eventos so acrescenta: % nao e permitido', TG_OP;
END;
$$ LANGUAGE plpgsql`,
  'DROP TRIGGER IF EXISTS gf_email_eventos_imutavel ON gf_email_eventos',
  `CREATE TRIGGER gf_email_eventos_imutavel BEFORE UPDATE OR DELETE ON gf_email_eventos
  FOR EACH ROW EXECUTE FUNCTION gf_email_eventos_imutavel()`,
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
  // Aditiva: não há reversão automática (nunca apaga configuração nem recibo).
  async down() {},
};
