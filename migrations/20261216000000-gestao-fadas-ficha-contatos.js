'use strict';

/**
 * Gestão Fadas, ficha da cliente: e-mail 2 e telefone comercial (decisão da Nice, 09/11: "há cadastros antigos que usavam"). PostgreSQL novo;
 * NADA no MySQL legado (somente leitura). Acrescenta a `gf_clientes_ext` (mesmo id do legado) `email2` e `telefone_comercial`. A data de nascimento
 * não precisa de coluna: já é gravada em `dados.birthDate` pela identidade da cliente. Coluna sem valor é NULL: o complemento vence quando
 * preenchido e o vazio nunca apaga o legado. Nada é preenchido em massa. Idempotente. Os CHECKs vêm de src/gestao-fadas/novo/esquema-checks-ficha.js.
 */

const { CHECKS_FICHA_DADOS_2 } = require('../src/gestao-fadas/novo/esquema-checks-ficha');

const DDL = [
  `ALTER TABLE gf_clientes_ext
  ADD COLUMN IF NOT EXISTS email2 VARCHAR(100),
  ADD COLUMN IF NOT EXISTS telefone_comercial VARCHAR(50)`,
  ...CHECKS_FICHA_DADOS_2.gf_clientes_ext
    .flatMap(([nome, expr]) => [`ALTER TABLE gf_clientes_ext DROP CONSTRAINT IF EXISTS ${nome}`, `ALTER TABLE gf_clientes_ext ADD CONSTRAINT ${nome} CHECK (${expr})`]),
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
