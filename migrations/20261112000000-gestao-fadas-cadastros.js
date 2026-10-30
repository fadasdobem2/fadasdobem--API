'use strict';

/**
 * Gestão Fadas, fatia Cadastros (catálogo real de tarólogos e clientes; Maturacao/29 seção 9): cinco tabelas no PostgreSQL novo.
 *  - `gf_tarologos_perfil`: o perfil EDITÁVEL do diretório de tarólogos. O tarólogo do legado (`tbl_tarologos`, só leitura) é ligado
 *    por `id_legado`; `tarot_id` é o id que Agenda, Consultas, Horários e Presença usam (o `idTarologo` como texto, ou `tarot-...`
 *    para quem nasce de um cadastro aprovado); `conta_slug` liga a conta da taróloga (`specialists.slug`) ao tarólogo.
 *  - `gf_cadastros_tarologo` (+ `_envios`, `_links`): o contrato de `/api/tarologos-cadastro` (ficha, envio público idempotente,
 *    link de atualização, aprovação com revisão), como o `registration-service` do front mantém no D1.
 *  - `gf_clientes_ext`: o que o cadastro do cliente do legado NÃO guarda ou o que a equipe edita (Pré/Pós, tratamento, dados),
 *    sobreposto à leitura do legado. NADA é escrito em `usuarios`.
 * Idempotente: CREATE ... IF NOT EXISTS. Os CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_tarologos_perfil (
  tarot_id VARCHAR(64) NOT NULL,
  id_legado INTEGER,
  conta_slug VARCHAR(64),
  nome VARCHAR(120),
  avatar TEXT,
  cadastro_ativo BOOLEAN,
  perfil JSONB NOT NULL DEFAULT '{}'::jsonb,
  registro_id VARCHAR(100),
  registro_revisao INTEGER,
  revisao INTEGER NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128),
  PRIMARY KEY (tarot_id),
${ck('gf_tarologos_perfil')}
)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_tarologos_perfil_legado ON gf_tarologos_perfil (id_legado) WHERE id_legado IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_tarologos_perfil_conta ON gf_tarologos_perfil (conta_slug) WHERE conta_slug IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_tarologos_perfil_registro ON gf_tarologos_perfil (registro_id) WHERE registro_id IS NOT NULL',

  `CREATE TABLE IF NOT EXISTS gf_cadastros_tarologo (
  id VARCHAR(100) NOT NULL,
  dados JSONB NOT NULL,
  status VARCHAR(10) NOT NULL,
  revisao INTEGER NOT NULL DEFAULT 1,
  tarot_id VARCHAR(100),
  aprovado_dados JSONB,
  aprovado_publico JSONB,
  aprovado_revisao INTEGER,
  aprovado_em TIMESTAMPTZ,
  aprovado_por VARCHAR(120),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_por VARCHAR(120) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_cadastros_tarologo')}
)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_cadastros_tarologo_tarot ON gf_cadastros_tarologo (tarot_id) WHERE tarot_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS gf_cadastros_tarologo_recentes ON gf_cadastros_tarologo (atualizado_em DESC)',

  `CREATE TABLE IF NOT EXISTS gf_cadastros_tarologo_envios (
  chave_hash VARCHAR(64) NOT NULL,
  impressao VARCHAR(64) NOT NULL,
  id_cadastro VARCHAR(100) NOT NULL,
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chave_hash),
  CONSTRAINT fk_cadastros_envios_cadastro FOREIGN KEY (id_cadastro) REFERENCES gf_cadastros_tarologo (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
${ck('gf_cadastros_tarologo_envios')}
)`,

  `CREATE TABLE IF NOT EXISTS gf_cadastros_tarologo_links (
  id_cadastro VARCHAR(100) NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  revisao_emitida INTEGER NOT NULL,
  expira_em TIMESTAMPTZ NOT NULL,
  consumido_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  PRIMARY KEY (id_cadastro),
  CONSTRAINT fk_cadastros_links_cadastro FOREIGN KEY (id_cadastro) REFERENCES gf_cadastros_tarologo (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
${ck('gf_cadastros_tarologo_links')}
)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_cadastros_links_token ON gf_cadastros_tarologo_links (token_hash)',

  `CREATE TABLE IF NOT EXISTS gf_clientes_ext (
  id_cliente VARCHAR(10) NOT NULL,
  perfil_pagamento VARCHAR(10),
  perfil_pagamento_em TIMESTAMPTZ,
  dados JSONB NOT NULL DEFAULT '{}'::jsonb,
  revisao INTEGER NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id_cliente),
${ck('gf_clientes_ext')}
)`,
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
