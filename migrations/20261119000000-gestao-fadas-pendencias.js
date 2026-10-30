'use strict';

/**
 * Gestão Fadas, fatia Pendências (Maturacao/34): uma tabela no PostgreSQL novo. NADA no MySQL legado.
 *  - `gf_pendencias_encaminhamentos`: o ENCAMINHAMENTO de cada pendência (o `PendingRouting` do front em `item`: snapshot, fila, resolvida e
 *    histórico, que só cresce), com revisão otimista (`version`). A pendência em si é derivada no navegador de consultas, pagamentos,
 *    divergências e agenda; o servidor guarda só a responsabilidade (fila) e o histórico.
 * Idempotente: CREATE ... IF NOT EXISTS. As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_pendencias_encaminhamentos (
  chave VARCHAR(300) NOT NULL,
  fila VARCHAR(14) NOT NULL,
  resolvida BOOLEAN NOT NULL DEFAULT FALSE,
  item JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (chave),
${ck('gf_pendencias_encaminhamentos')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_pendencias_fila ON gf_pendencias_encaminhamentos (fila, resolvida)',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
