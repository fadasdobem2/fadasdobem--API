'use strict';

/**
 * Gestão Fadas, espelho no legado (Maturacao/45). SÓ colunas de vínculo no PostgreSQL novo; nada no MySQL do legado.
 * Mesmo mecanismo do espelho de consultas (`gf_consultas_ext.legado_*`), agora para as entidades que têm casa no legado:
 *  - `gf_clientes_ext`: nome de identificação, "tratar por", WhatsApp e nascimento (em `usuarios`);
 *  - `gf_tarologos_perfil`: nome e situação do cadastro (em `tbl_tarologos`), só onde `id_legado` existe.
 * Colunas: `legado_estado` (nao_espelhada, pendente, espelhada, sem_registro, erro), `legado_detalhe` (motivo curto, sem segredo),
 * `legado_pendentes` (campos do Postgres ainda NÃO escritos no legado: é a INTENÇÃO e também a regra de leitura, ver legado-escrita/fusao.js)
 * e `legado_atualizado_em` (para a reconciliação não competir com uma sincronização em andamento).
 * Linhas que já existem nasceram sem espelho: todo campo espelhável que elas guardam fica pendente (o que valia na leitura continua valendo).
 * Idempotente. Os CHECKs vêm de `CHECKS_ESPELHO` (src/gestao-fadas/novo/esquema-checks.js).
 */

const { CHECKS_ESPELHO } = require('../src/gestao-fadas/novo/esquema-checks');

const TABELAS = ['gf_clientes_ext', 'gf_tarologos_perfil'];

// Literais (não gerados em laço): o comparador "estrito" de scripts/apoio-esquema lê este arquivo como TEXTO para saber que colunas a migração cria.
const DDL = [
  "ALTER TABLE gf_clientes_ext ADD COLUMN IF NOT EXISTS legado_estado VARCHAR(16) NOT NULL DEFAULT 'nao_espelhada'",
  'ALTER TABLE gf_clientes_ext ADD COLUMN IF NOT EXISTS legado_detalhe VARCHAR(300)',
  "ALTER TABLE gf_clientes_ext ADD COLUMN IF NOT EXISTS legado_pendentes JSONB NOT NULL DEFAULT '[]'::jsonb",
  'ALTER TABLE gf_clientes_ext ADD COLUMN IF NOT EXISTS legado_atualizado_em TIMESTAMPTZ',
  "ALTER TABLE gf_tarologos_perfil ADD COLUMN IF NOT EXISTS legado_estado VARCHAR(16) NOT NULL DEFAULT 'nao_espelhada'",
  'ALTER TABLE gf_tarologos_perfil ADD COLUMN IF NOT EXISTS legado_detalhe VARCHAR(300)',
  "ALTER TABLE gf_tarologos_perfil ADD COLUMN IF NOT EXISTS legado_pendentes JSONB NOT NULL DEFAULT '[]'::jsonb",
  'ALTER TABLE gf_tarologos_perfil ADD COLUMN IF NOT EXISTS legado_atualizado_em TIMESTAMPTZ',
  ...TABELAS.flatMap((t) => CHECKS_ESPELHO[t].flatMap(([nome, expr]) => [`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${nome}`, `ALTER TABLE ${t} ADD CONSTRAINT ${nome} CHECK (${expr})`])),
];

const RETROATIVO = [
  `UPDATE gf_clientes_ext SET legado_pendentes = (SELECT COALESCE(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM jsonb_object_keys(dados) AS k WHERE k IN ('birthDate', 'name', 'treatAs', 'whatsapp'))
   WHERE legado_estado = 'nao_espelhada' AND legado_pendentes = '[]'::jsonb`,
  `UPDATE gf_tarologos_perfil SET legado_pendentes = (SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) FROM (SELECT 'nome' AS c WHERE nome IS NOT NULL UNION ALL SELECT 'cadastro_ativo' WHERE cadastro_ativo IS NOT NULL) AS t)
   WHERE legado_estado = 'nao_espelhada' AND legado_pendentes = '[]'::jsonb`,
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
    for (const sql of RETROATIVO) await sequelize.query(sql);
  },
};
