'use strict';

/**
 * Gestão Fadas, fatia Horários e escala (Maturacao/28 seção 5.4, reconferida com o front): três tabelas no PostgreSQL novo.
 *  - `gf_escalas_semanais`: o horário habitual por dia da semana (texto como o front guarda, ex. "9h às 15h · 16h às 22h" ou "Folga");
 *  - `gf_horarios_excecoes`: as exceções por data ou período (`ScheduleOverride`); remover é marcar `removida_em` (o executor
 *    do banco novo não faz DELETE, e a linha antiga fica como histórico); os textos de instante do front (`updatedAt`,
 *    `noteUpdatedAt`, `rosterResponse.at`) ficam em TEXT idênticos ao recebido, porque o front os compara com a leitura dele;
 *  - `gf_horarios_periodos`: os períodos de cada exceção, de 1 a 3 (o front aceita três nas respostas da escala; o contrato dizia 2).
 * Idempotente: CREATE ... IF NOT EXISTS. As expressões dos CHECKs vêm de src/gestao-fadas/novo/esquema-checks.js.
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_escalas_semanais (
  id_tarologo VARCHAR(64) NOT NULL,
  weekday VARCHAR(8) NOT NULL,
  hours VARCHAR(200) NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id_tarologo, weekday),
${ck('gf_escalas_semanais')}
)`,

  `CREATE TABLE IF NOT EXISTS gf_horarios_excecoes (
  id VARCHAR(64) NOT NULL,
  id_tarologo VARCHAR(64) NOT NULL,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  absence_type VARCHAR(20) NOT NULL DEFAULT 'Nenhuma',
  today_hours VARCHAR(200) NOT NULL,
  observacao TEXT NOT NULL DEFAULT '',
  updated_at_texto VARCHAR(40) NOT NULL,
  note_updated_at VARCHAR(40),
  note_start_date DATE,
  note_end_date DATE,
  command_id VARCHAR(64),
  roster_actor VARCHAR(120),
  roster_at VARCHAR(40),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  operation_key VARCHAR(64) NOT NULL,
  removida_em TIMESTAMPTZ,
  PRIMARY KEY (id),
${ck('gf_horarios_excecoes')}
)`,
  'CREATE INDEX IF NOT EXISTS gf_horarios_excecoes_busca ON gf_horarios_excecoes (id_tarologo, data_inicio, data_fim)',
  // Duas exceções ativas com o mesmo recorte do mesmo tarólogo colidem (corrida entre duas gravações): a segunda falha e vira conflito de versão.
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_horarios_excecoes_ativa ON gf_horarios_excecoes (id_tarologo, data_inicio, data_fim) WHERE removida_em IS NULL',

  `CREATE TABLE IF NOT EXISTS gf_horarios_periodos (
  id_excecao VARCHAR(64) NOT NULL,
  ordem SMALLINT NOT NULL,
  inicio TIME NOT NULL,
  fim TIME NOT NULL,
  PRIMARY KEY (id_excecao, ordem),
  CONSTRAINT fk_horarios_periodos_excecao FOREIGN KEY (id_excecao) REFERENCES gf_horarios_excecoes (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
${ck('gf_horarios_periodos')}
)`,
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
