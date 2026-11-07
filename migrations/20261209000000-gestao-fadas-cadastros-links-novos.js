'use strict';

/**
 * Banco novo (PostgreSQL da A), fatia Cadastros, v706 da Nice:
 *  - `gf_cadastros_tarologo_novos_links`: "Criar link para novo perfil" (Form Tarólogo). Valem 7 dias, aceitam UM envio concluído; abrir ou preencher
 *    parcialmente não consome; a administração pode cancelar. Guarda só a impressão SHA-256 do token (nunca o token nem o link).
 *  - `gf_cadastros_tarologo.envio_original`: o primeiro envio ({ data, receivedAt }), imutável e distinto da ficha editada.
 * Idempotente. Nada no MySQL legado.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  'ALTER TABLE gf_cadastros_tarologo ADD COLUMN IF NOT EXISTS envio_original JSONB',
  `CREATE TABLE IF NOT EXISTS gf_cadastros_tarologo_novos_links (
  id VARCHAR(100) NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  emitido_em TIMESTAMPTZ NOT NULL,
  expira_em TIMESTAMPTZ NOT NULL,
  consumido_em TIMESTAMPTZ,
  revogado_em TIMESTAMPTZ,
  id_cadastro VARCHAR(100),
  criado_por VARCHAR(120) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_cadastros_novos_links_cadastro FOREIGN KEY (id_cadastro) REFERENCES gf_cadastros_tarologo (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
${ck('gf_cadastros_tarologo_novos_links')}
)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_cadastros_novos_links_token ON gf_cadastros_tarologo_novos_links (token_hash)',
  'CREATE INDEX IF NOT EXISTS gf_cadastros_novos_links_recentes ON gf_cadastros_tarologo_novos_links (emitido_em DESC)',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
