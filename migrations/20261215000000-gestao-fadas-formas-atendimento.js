'use strict';

/**
 * Gestão Fadas, formas de atendimento do dia (v711 da Nice, migração 004_professional_service_days): PostgreSQL novo. NADA no MySQL legado.
 * `gf_formas_atendimento_dia`: uma linha por profissional e dia operacional com os meios em que ela atende naquele dia (PABX, Áudio, Texto),
 * revisão otimista e quem alterou. Painel, equipe e Lilly leem as MESMAS linhas. Aditiva e idempotente; CHECK em esquema-checks-formas.js.
 */

const { CHECKS_FORMAS } = require('../src/gestao-fadas/novo/esquema-checks-formas');

const ck = CHECKS_FORMAS.gf_formas_atendimento_dia.map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_formas_atendimento_dia (
  tarologo_id VARCHAR(160) NOT NULL,
  data_operacional DATE NOT NULL,
  formas JSONB NOT NULL,
  revisao INTEGER NOT NULL DEFAULT 1,
  atualizado_em TIMESTAMPTZ NOT NULL,
  atualizado_por VARCHAR(160) NOT NULL,
  PRIMARY KEY (tarologo_id, data_operacional),
${ck}
)`,
  'CREATE INDEX IF NOT EXISTS gf_formas_atendimento_dia_data ON gf_formas_atendimento_dia (data_operacional)',
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
  async down() {},
};
