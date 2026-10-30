'use strict';

/**
 * Gestão Fadas, fatia Valores, Pagamentos e Restrições (Maturacao/29 seção 10): seis tabelas no PostgreSQL novo. NADA no MySQL legado.
 *  - `gf_precos_versoes`: versões da tabela de valores (só acrescenta; a vigente é decidida por `effectiveAt`; a VAL-001 do front é implícita);
 *  - `gf_pagamentos`: um recebimento por linha (o `PaymentRecord` do front em `item`, com movimentos e auditoria embutidos, que só crescem)
 *    e `gf_pagamentos_eventos`, trilha imutável por revisão;
 *  - `gf_beneficios_minutos`: Bônus e Cortesia concedidos a uma cliente (só acrescenta; o consumo vive na consulta);
 *  - `gf_saldos_partida`: o `saldo - valorAPagar` do legado CONGELADO na primeira vez que a cliente é usada (leitura do legado, uma vez);
 *  - `gf_restricoes`: cliente x taróloga; índice único parcial garante UMA restrição ativa por (cliente, taróloga, quem pediu).
 * Idempotente: CREATE ... IF NOT EXISTS. As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_precos_versoes (
  id VARCHAR(64) NOT NULL,
  vigente_desde TIMESTAMPTZ NOT NULL,
  item JSONB NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_precos_versoes')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_precos_versoes_vigencia ON gf_precos_versoes (vigente_desde, criado_em)',

  `CREATE TABLE IF NOT EXISTS gf_pagamentos (
  id VARCHAR(64) NOT NULL,
  id_cliente VARCHAR(10) NOT NULL,
  status VARCHAR(20) NOT NULL,
  confirmacao VARCHAR(16),
  valor_centavos BIGINT NOT NULL,
  metodo VARCHAR(24) NOT NULL,
  id_consulta VARCHAR(64),
  informado_em TIMESTAMPTZ NOT NULL,
  item JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_pagamentos')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_pagamentos_cliente ON gf_pagamentos (id_cliente, informado_em)',
  'CREATE INDEX IF NOT EXISTS gf_pagamentos_consulta ON gf_pagamentos (id_consulta) WHERE id_consulta IS NOT NULL',

  `CREATE TABLE IF NOT EXISTS gf_pagamentos_eventos (
  id VARCHAR(64) NOT NULL,
  id_pagamento VARCHAR(64) NOT NULL,
  tipo VARCHAR(16) NOT NULL,
  ator_id VARCHAR(64) NOT NULL,
  ator_nome VARCHAR(120) NOT NULL,
  ator_perfil VARCHAR(20) NOT NULL,
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dados JSONB NOT NULL,
  versao BIGINT NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_pagamentos_eventos_pagamento FOREIGN KEY (id_pagamento) REFERENCES gf_pagamentos (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
${ck('gf_pagamentos_eventos')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_pagamentos_eventos_pagamento ON gf_pagamentos_eventos (id_pagamento, ocorrido_em)',

  `CREATE TABLE IF NOT EXISTS gf_beneficios_minutos (
  id VARCHAR(64) NOT NULL,
  id_cliente VARCHAR(10) NOT NULL,
  tipo VARCHAR(10) NOT NULL,
  minutos INTEGER NOT NULL,
  item JSONB NOT NULL,
  concedido_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  concedido_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_beneficios_minutos')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_beneficios_minutos_cliente ON gf_beneficios_minutos (id_cliente, concedido_em)',

  `CREATE TABLE IF NOT EXISTS gf_saldos_partida (
  id_cliente VARCHAR(10) NOT NULL,
  centavos BIGINT NOT NULL,
  fonte VARCHAR(60) NOT NULL,
  congelado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  congelado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id_cliente),
${ck('gf_saldos_partida')}
)`,

  `CREATE TABLE IF NOT EXISTS gf_restricoes (
  id VARCHAR(64) NOT NULL,
  id_cliente VARCHAR(10) NOT NULL,
  id_tarologo VARCHAR(64) NOT NULL,
  solicitante VARCHAR(10) NOT NULL,
  ativa BOOLEAN NOT NULL,
  item JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_restricoes')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_restricoes_cliente ON gf_restricoes (id_cliente)',
  'CREATE INDEX IF NOT EXISTS gf_restricoes_tarologo ON gf_restricoes (id_tarologo)',
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_restricoes_ativa ON gf_restricoes (id_cliente, id_tarologo, solicitante) WHERE ativa = true',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
