'use strict';

/**
 * Gestão Fadas, fatias 5 a 7 (ciclo da consulta; Maturacao/28 seção 4, reconferida com o código do front): duas tabelas no PostgreSQL novo.
 *  - `gf_consultas_ext`: uma consulta por linha. As colunas guardam o que a API consulta (tarólogo, cliente, estado, comissão capturada,
 *    início, versão); `item` é a `OperationalConsultation` do front como o front a lê (campo ausente fica ausente), com as histórias
 *    (auditoria, pausas, relato final, correções, avisos) embutidas, que só crescem. `id_consulta_legado` e `legado_estado` guardam
 *    o vínculo com `tbl_consultas` quando o espelho do legado está ligado (não se pode acrescentar coluna no legado);
 *  - `gf_consultas_eventos`: trilha imutável por consulta. O índice único parcial `uq_consultas_termino` garante "o tarólogo encerra
 *    UMA vez" no banco; `uq_consultas_eventos_ref` impede o mesmo evento do front de entrar duas vezes.
 * O contrato propunha 11 tabelas normalizadas; esta fatia guarda as histórias dentro do item (ver Maturacao/29, seção 8).
 * Idempotente: CREATE ... IF NOT EXISTS. As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_consultas_ext (
  id VARCHAR(64) NOT NULL,
  id_consulta_legado VARCHAR(10),
  legado_estado VARCHAR(16) NOT NULL DEFAULT 'nao_espelhada',
  legado_detalhe VARCHAR(300),
  legado_atualizado_em TIMESTAMPTZ,
  id_tarologo VARCHAR(64) NOT NULL,
  id_cliente VARCHAR(64) NOT NULL,
  id_agenda VARCHAR(64),
  consulta_origem_id VARCHAR(64),
  status VARCHAR(32) NOT NULL,
  perfil_pagamento VARCHAR(12),
  canal VARCHAR(24),
  comissao_percentual NUMERIC(7,4) NOT NULL,
  aguardando_inicio BOOLEAN NOT NULL DEFAULT TRUE,
  iniciada_em TIMESTAMPTZ NOT NULL,
  encerrada_em TIMESTAMPTZ,
  tarologo_iniciou_em TIMESTAMPTZ,
  duracao_segundos INTEGER NOT NULL DEFAULT 0,
  item JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_consultas_ext')}
)`,
  "CREATE INDEX IF NOT EXISTS gf_consultas_ext_abertas_tarologo ON gf_consultas_ext (id_tarologo) WHERE status = 'Em curso'",
  "CREATE INDEX IF NOT EXISTS gf_consultas_ext_abertas_cliente ON gf_consultas_ext (id_cliente) WHERE status = 'Em curso'",
  'CREATE INDEX IF NOT EXISTS gf_consultas_ext_dia ON gf_consultas_ext (iniciada_em)',
  'CREATE INDEX IF NOT EXISTS gf_consultas_ext_agenda ON gf_consultas_ext (id_agenda) WHERE id_agenda IS NOT NULL',
  // Uma continuação válida por origem (v323): anulada, erro, devolvida e "não houve" liberam a origem.
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_consultas_continuacao ON gf_consultas_ext (consulta_origem_id) WHERE consulta_origem_id IS NOT NULL AND status NOT IN ('Anulada', 'Erro', 'Devolvida', 'Não houve')",
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_consultas_legado ON gf_consultas_ext (id_consulta_legado) WHERE id_consulta_legado IS NOT NULL',

  `CREATE TABLE IF NOT EXISTS gf_consultas_eventos (
  id VARCHAR(64) NOT NULL,
  id_consulta VARCHAR(64) NOT NULL,
  tipo VARCHAR(16) NOT NULL,
  evento_ref VARCHAR(200),
  ator_id VARCHAR(64) NOT NULL,
  ator_nome VARCHAR(120) NOT NULL,
  ator_perfil VARCHAR(20) NOT NULL,
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dados JSONB NOT NULL,
  versao BIGINT NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_consultas_eventos_consulta FOREIGN KEY (id_consulta) REFERENCES gf_consultas_ext (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
${ck('gf_consultas_eventos')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_consultas_eventos_consulta ON gf_consultas_eventos (id_consulta, ocorrido_em)',
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_consultas_eventos_ref ON gf_consultas_eventos (id_consulta, tipo, evento_ref) WHERE evento_ref IS NOT NULL',
  // O tarólogo (ou a equipe, pelo mesmo relato) encerra UMA vez: segunda tentativa cai aqui mesmo se o service falhar.
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_consultas_termino ON gf_consultas_eventos (id_consulta) WHERE tipo = 'termino'",
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
