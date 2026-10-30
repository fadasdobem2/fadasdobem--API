'use strict';

/**
 * Gestão Fadas, trava da ficha do ASP (Maturacao/53): UMA tabela nova no PostgreSQL novo, nada no MySQL do legado.
 *  - `gf_legado_verificacoes`: uma linha por conferência agendada depois que o painel grava um campo de cliente/tarólogo no legado (o valor antigo e o novo
 *    vêm da intenção `gf_legado_intencoes`). Sobrevive ao reinício da API: o job lê as `pendente` vencidas ao subir.
 *  - `legado_estado` de `gf_clientes_ext` e `gf_tarologos_perfil` passa a aceitar `reaplicada` e `divergente` (o resultado da conferência).
 * Idempotente. Os CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS, CHECKS_ESPELHO } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');
const TABELAS = ['gf_clientes_ext', 'gf_tarologos_perfil'];

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_legado_verificacoes (
  id VARCHAR(64) NOT NULL,
  intencao_id VARCHAR(64) NOT NULL,
  entidade VARCHAR(16) NOT NULL,
  entidade_id VARCHAR(64) NOT NULL,
  legado_id VARCHAR(20),
  coluna VARCHAR(24) NOT NULL,
  etapa SMALLINT NOT NULL,
  vence_em TIMESTAMPTZ NOT NULL,
  estado VARCHAR(12) NOT NULL DEFAULT 'pendente',
  apos_reaplicacao BOOLEAN NOT NULL DEFAULT FALSE,
  tentativas SMALLINT NOT NULL DEFAULT 0,
  detalhe VARCHAR(300),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
${ck('gf_legado_verificacoes')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_legado_verificacoes_vence ON gf_legado_verificacoes (estado, vence_em)',
  'CREATE INDEX IF NOT EXISTS gf_legado_verificacoes_entidade ON gf_legado_verificacoes (entidade, entidade_id, coluna)',
  ...TABELAS.flatMap((t) => CHECKS_ESPELHO[t].filter(([nome]) => /estado/.test(nome)).flatMap(([nome, expr]) => [`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${nome}`, `ALTER TABLE ${t} ADD CONSTRAINT ${nome} CHECK (${expr})`])),
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
