'use strict';

/**
 * `GET /ops/health` no envelope da B (`HealthBody`, contracts/health.md). 200 só com tudo ok; senão 503 com o mesmo
 * corpo. Outro método: 405 `{ error: 'method-not-allowed' }` + Allow.
 *
 * Os checks seguem a B: `configuration` (legado configurado), `database` (SELECT 1) e `schema` (as tabelas que as
 * rotas leem existem). Falha de banco = `database-unavailable`; tabela ausente = `schema-incompatible`.
 * A identidade do build (releaseId, commitSha, environment) vem do ambiente: GATE_RELEASE_ID, GATE_COMMIT_SHA, FADAS_ENVIRONMENT.
 */

const { Router } = require('express');
const { enviarJson } = require('./http');

/** Tabelas do LEGADO que as leituras do gate exigem. */
const TABELAS_LEGADO = Object.freeze([
  'usuarios', 'tbl_consultas', 'tbl_tarologos', 'tbl_pagtoinformado', 'tbl_pagtoconfirmado', 'tbl_pagtonaolocalizado',
]);

/**
 * `gf_auditoria` (exportação e histórico) mora no PostgreSQL da A no modo padrão (`GF_NOVOS_DADOS=postgres`); só no modo `mysql` ela
 * precisa existir no legado. Em produção o legado só tem as `gf_auth_*` da B, então exigi-la ali daria 503 com a API boa.
 */
const tabelasExigidasNoLegado = (env = process.env) => (require('../novo/modo').novosDadosNoPostgres(env) ? TABELAS_LEGADO : [...TABELAS_LEGADO, 'gf_auditoria']);

async function auditoriaNoPostgres() {
  const [linhas] = await require('../../config/database').sequelize.query("SELECT to_regclass('gf_auditoria') AS t");
  return Boolean(linhas && linhas[0] && linhas[0].t);
}

/** Estado do legado: 'ok' | 'database-unavailable' | 'schema-incompatible' | 'configuration-unavailable'. */
async function estadoPadrao() {
  const { statusLegado } = require('../../models/legado');
  const { getLegadoSequelize } = require('../../models/legado/connection');
  const s = await statusLegado();
  if (!s || !s.configurado) return 'configuration-unavailable';
  if (!s.conectado) return 'database-unavailable';
  const [linhas] = await getLegadoSequelize().query('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  const existentes = new Set(linhas.map((l) => String(l.t || l.TABLE_NAME).toLowerCase()));
  if (!tabelasExigidasNoLegado().every((t) => existentes.has(t))) return 'schema-incompatible';
  if (require('../novo/modo').novosDadosNoPostgres() && !(await auditoriaNoPostgres())) return 'schema-incompatible';
  return 'ok';
}

/** Identidade do build como a B publica; se faltar ou for inválida, null. */
function identidadeDoBuild(env = process.env) {
  const commit = `${env.GATE_COMMIT_SHA || ''}`.trim();
  const release = `${env.GATE_RELEASE_ID || ''}`.trim();
  const ambiente = `${env.FADAS_ENVIRONMENT || ''}`.trim();
  return {
    releaseId: /^[0-9a-f]{40}-[1-9][0-9]*-[1-9][0-9]*$/.test(release) ? release : null,
    commitSha: /^[0-9a-f]{40}$/.test(commit) ? commit : null,
    environment: ambiente === 'test' ? 'dev' : ambiente === 'production' ? 'prd' : null,
  };
}

const CHECKS = {
  ok: { configuration: 'ok', database: 'ok', schema: 'ok' },
  'configuration-unavailable': { configuration: 'failed', database: 'unknown', schema: 'unknown' },
  'database-unavailable': { configuration: 'ok', database: 'failed', schema: 'unknown' },
  'schema-incompatible': { configuration: 'ok', database: 'ok', schema: 'failed' },
};

function criarRotaHealth({ estadoDoBanco = estadoPadrao, verificarLegado, agora = () => new Date() } = {}) {
  const router = Router();
  router.all('/ops/health', async (req, res) => {
    if (req.method !== 'GET') return enviarJson(res, 405, { error: 'method-not-allowed' }, { Allow: 'GET' });
    let estado = 'database-unavailable';
    try {
      // `verificarLegado` (boolean) é a forma antiga, mantida para os testes que o injetam.
      estado = verificarLegado ? ((await verificarLegado()) ? 'ok' : 'database-unavailable') : await estadoDoBanco();
    } catch (_e) { estado = 'database-unavailable'; }
    const pronto = estado === 'ok';
    return enviarJson(res, pronto ? 200 : 503, {
      schemaVersion: 1,
      status: pronto ? 'ready' : 'unavailable',
      reasonCode: pronto ? null : estado,
      ...identidadeDoBuild(),
      mode: 'real',
      checkedAt: agora().toISOString(),
      checks: CHECKS[estado] || CHECKS['database-unavailable'],
    });
  });
  return router;
}

module.exports = { criarRotaHealth, identidadeDoBuild, TABELAS_EXIGIDAS: TABELAS_LEGADO, TABELAS_LEGADO, tabelasExigidasNoLegado };
