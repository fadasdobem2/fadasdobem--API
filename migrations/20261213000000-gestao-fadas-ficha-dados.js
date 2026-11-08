'use strict';

/**
 * Gestão Fadas, dados da ficha da cliente (decisão da Nice, 08/11): PostgreSQL novo. NADA no MySQL legado (somente leitura).
 * Acrescenta a `gf_clientes_ext` (uma linha por cliente, pelo MESMO id do legado; nenhum outro cadastro) o que o legado não recebe do editor:
 * `nome_completo`, `cpf`, `email`, `telefones` (lista na ordem do editor, com os índices do telefone de consultas e do WhatsApp) e o endereço
 * (`end_*`). Coluna sem valor é NULL: na leitura, o complemento vence quando preenchido e o vazio nunca apaga o legado. Nada é preenchido em massa.
 * Idempotente. Os CHECKs vêm de src/gestao-fadas/novo/esquema-checks-ficha.js.
 */

const { CHECKS_FICHA_DADOS } = require('../src/gestao-fadas/novo/esquema-checks-ficha');

const DDL = [
  `ALTER TABLE gf_clientes_ext
  ADD COLUMN IF NOT EXISTS nome_completo VARCHAR(255),
  ADD COLUMN IF NOT EXISTS cpf VARCHAR(50),
  ADD COLUMN IF NOT EXISTS email VARCHAR(50),
  ADD COLUMN IF NOT EXISTS telefones JSONB,
  ADD COLUMN IF NOT EXISTS telefone_consulta_idx SMALLINT,
  ADD COLUMN IF NOT EXISTS telefone_whatsapp_idx SMALLINT,
  ADD COLUMN IF NOT EXISTS end_rua VARCHAR(200),
  ADD COLUMN IF NOT EXISTS end_numero VARCHAR(20),
  ADD COLUMN IF NOT EXISTS end_complemento VARCHAR(100),
  ADD COLUMN IF NOT EXISTS end_bairro VARCHAR(100),
  ADD COLUMN IF NOT EXISTS end_cep VARCHAR(24),
  ADD COLUMN IF NOT EXISTS end_cidade VARCHAR(100),
  ADD COLUMN IF NOT EXISTS end_uf VARCHAR(100),
  ADD COLUMN IF NOT EXISTS end_pais VARCHAR(100)`,
  ...CHECKS_FICHA_DADOS.gf_clientes_ext
    .flatMap(([nome, expr]) => [`ALTER TABLE gf_clientes_ext DROP CONSTRAINT IF EXISTS ${nome}`, `ALTER TABLE gf_clientes_ext ADD CONSTRAINT ${nome} CHECK (${expr})`]),
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
