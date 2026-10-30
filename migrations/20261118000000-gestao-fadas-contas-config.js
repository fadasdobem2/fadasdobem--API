'use strict';

/**
 * Banco novo (PostgreSQL da A), fatia Contas e Configurações (Maturacao/33). NADA no MySQL legado.
 *  - `gf_contas_ext`: o que a conta do front tem e a tabela `users` da A não tem (ID no sistema antigo, foto) e a revisão otimista da conta
 *    (0 enquanto não existe a linha). Senha, papéis e situação continuam em `users`/RBAC da A; aqui NUNCA há senha, hash nem token.
 *  - Boas-vindas usa a `gf_welcome` que já existe (migração 20261030120000): nada novo para ela.
 * Idempotente: CREATE ... IF NOT EXISTS. As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_contas_ext (
  user_id UUID NOT NULL,
  legacy_id VARCHAR(64),
  avatar TEXT,
  revisao INTEGER NOT NULL DEFAULT 1,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_por UUID,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_contas_ext_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_contas_ext_ator FOREIGN KEY (atualizado_por) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
${ck('gf_contas_ext')}
)`,
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
