'use strict';

/**
 * Gestão Fadas, fatias Agenda e Ordem da fila (Maturacao/28 seção 2.4, reconferida com o código do front): três tabelas no PostgreSQL novo.
 *  - `gf_agenda`: um agendamento por linha. As colunas guardam o que a API consulta (tarólogo, cliente, dia, posição, desfecho,
 *    número público, versão); `item` é o `AgendaItem` do front como o front o lê (campo ausente fica ausente), com as histórias
 *    (contatos, observações, saídas, prazos, resolução) embutidas, que só crescem;
 *  - `gf_agenda_eventos`: trilha imutável por agendamento (criação, contato, observação, prazo, saída, resolução, agendamento),
 *    com a chave natural do evento do front, para a mesma ação não entrar duas vezes;
 *  - `gf_agenda_ordem_comandos`: cada reordenação da fila (aplicada, recusada ou substituída), com a revisão `queue-v1` de base.
 * O contrato propunha 17 tabelas normalizadas; esta fatia guarda as histórias dentro do item (ver Maturacao/29, seção de desvios).
 * Idempotente: CREATE ... IF NOT EXISTS. As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_agenda (
  id VARCHAR(64) NOT NULL,
  numero_publico INTEGER NOT NULL,
  id_tarologo VARCHAR(64) NOT NULL,
  id_cliente VARCHAR(64) NOT NULL,
  data_operacional DATE NOT NULL,
  posicao INTEGER NOT NULL,
  agenda_outcome VARCHAR(12),
  item JSONB NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  criado_por VARCHAR(120) NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_agenda')}
)`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_agenda_numero_publico ON gf_agenda (numero_publico)',
  'CREATE INDEX IF NOT EXISTS gf_agenda_dia_tarologo ON gf_agenda (data_operacional, id_tarologo)',
  'CREATE INDEX IF NOT EXISTS gf_agenda_cliente ON gf_agenda (id_cliente)',

  `CREATE TABLE IF NOT EXISTS gf_agenda_eventos (
  id VARCHAR(64) NOT NULL,
  id_agenda VARCHAR(64) NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  evento_ref VARCHAR(160),
  ator_id VARCHAR(64) NOT NULL,
  ator_nome VARCHAR(120) NOT NULL,
  ator_perfil VARCHAR(20) NOT NULL,
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dados JSONB NOT NULL,
  versao BIGINT NOT NULL,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_agenda_eventos_agenda FOREIGN KEY (id_agenda) REFERENCES gf_agenda (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
${ck('gf_agenda_eventos')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_agenda_eventos_agenda ON gf_agenda_eventos (id_agenda, ocorrido_em)',
  // A mesma ação do front (mesmo id de evento) não entra duas vezes no mesmo agendamento.
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_agenda_eventos_ref ON gf_agenda_eventos (id_agenda, tipo, evento_ref) WHERE evento_ref IS NOT NULL',

  `CREATE TABLE IF NOT EXISTS gf_agenda_ordem_comandos (
  id VARCHAR(160) NOT NULL,
  fila VARCHAR(80) NOT NULL,
  base_revision VARCHAR(80) NOT NULL,
  revisao_resultante VARCHAR(80),
  status VARCHAR(12) NOT NULL,
  motivo VARCHAR(12),
  ator_id VARCHAR(64) NOT NULL,
  ator_nome VARCHAR(120) NOT NULL,
  ator_papel VARCHAR(20) NOT NULL,
  moved_id VARCHAR(64),
  before_ids JSONB NOT NULL,
  after_ids JSONB NOT NULL,
  lineage JSONB,
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  operation_key VARCHAR(128) NOT NULL,
  PRIMARY KEY (id),
${ck('gf_agenda_ordem_comandos')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_agenda_ordem_fila ON gf_agenda_ordem_comandos (fila, ocorrido_em)',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
