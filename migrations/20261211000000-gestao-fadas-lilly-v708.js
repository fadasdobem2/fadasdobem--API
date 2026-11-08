'use strict';

/**
 * Gestão Fadas, Lilly v708 (Maturacao/59, 60 e docs/banco/21 da Nice): PostgreSQL novo. NADA no MySQL legado (a migração 002 MySQL da Nice NÃO se aplica aqui).
 *  - `gf_clientes_ext.situacao_cadastral` (NULL | 'dados_pendentes' | 'completo'; NUNCA preenchida em massa, não é o `perfil_pagamento`) e `sem_email`
 *    (declaração explícita de "não tem e-mail", que a migração da Nice não persistia).
 *  - `gf_clientes_novos`: cliente criada pela Lilly no banco novo, sem linha em `usuarios`. Nomes vazios enquanto desconhecidos e nascimento NULL.
 *    O ID vem da sequência `gf_clientes_novos_id_seq` (faixa própria de 1.000.000.000 a 2.147.483.647, que o auto incremento do legado não alcança).
 *  - `gf_lilly_mais_tempo`: pedido de mais tempo (ciclos por consulta), sem minutos, cobrança nem encerramento.
 *  - `gf_lilly_pagamento_refs`: `provider_confirmed`, `authorized_by` e unicidade GLOBAL (sem caixa) de referência, ID do Mercado Pago e endToEndId.
 * Idempotente. Os CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS, CHECKS_LILLY_V708 } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `ALTER TABLE gf_clientes_ext
  ADD COLUMN IF NOT EXISTS situacao_cadastral VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sem_email BOOLEAN`,
  ...CHECKS_LILLY_V708.gf_clientes_ext
    .flatMap(([nome, expr]) => [`ALTER TABLE gf_clientes_ext DROP CONSTRAINT IF EXISTS ${nome}`, `ALTER TABLE gf_clientes_ext ADD CONSTRAINT ${nome} CHECK (${expr})`]),

  'CREATE SEQUENCE IF NOT EXISTS gf_clientes_novos_id_seq AS BIGINT START WITH 1000000000 MINVALUE 1000000000 MAXVALUE 2147483647 NO CYCLE',
  `CREATE TABLE IF NOT EXISTS gf_clientes_novos (
  id_cliente VARCHAR(10) NOT NULL,
  nome VARCHAR(120) NOT NULL DEFAULT '',
  nome_id VARCHAR(50) NOT NULL DEFAULT '',
  nome2 VARCHAR(50) NOT NULL DEFAULT '',
  data_nascimento DATE,
  telefone VARCHAR(45),
  email VARCHAR(320),
  origem VARCHAR(16) NOT NULL DEFAULT 'lilly',
  source_contact_id VARCHAR(160),
  source_conversation_id VARCHAR(160),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id_cliente),
${ck('gf_clientes_novos')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_clientes_novos_telefone ON gf_clientes_novos (telefone)',
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_novos_operation_key ON gf_clientes_novos (operation_key)',

  `CREATE TABLE IF NOT EXISTS gf_lilly_mais_tempo (
  id VARCHAR(64) NOT NULL,
  consulta_id VARCHAR(64) NOT NULL,
  ciclo INTEGER NOT NULL,
  id_cliente VARCHAR(10) NOT NULL,
  id_tarologo VARCHAR(64) NOT NULL,
  solicitado_em TIMESTAMPTZ NOT NULL,
  source_event_id VARCHAR(200) NOT NULL,
  source_conversation_id VARCHAR(160),
  rotulo VARCHAR(60) NOT NULL,
  altera_duracao BOOLEAN NOT NULL DEFAULT FALSE,
  encerra_consulta BOOLEAN NOT NULL DEFAULT FALSE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
${ck('gf_lilly_mais_tempo')}
)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_lilly_mais_tempo_ciclo ON gf_lilly_mais_tempo (consulta_id, ciclo)',
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_lilly_mais_tempo_evento ON gf_lilly_mais_tempo (source_event_id)',

  `ALTER TABLE gf_lilly_pagamento_refs
  ADD COLUMN IF NOT EXISTS provider_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS authorized_by VARCHAR(200)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_lilly_refs_reference ON gf_lilly_pagamento_refs (lower(reference)) WHERE reference IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_lilly_refs_mp ON gf_lilly_pagamento_refs (lower(mp_payment_id)) WHERE mp_payment_id IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_lilly_refs_e2e ON gf_lilly_pagamento_refs (lower(end_to_end_id)) WHERE end_to_end_id IS NOT NULL',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
