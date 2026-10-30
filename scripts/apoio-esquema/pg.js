'use strict';
/**
 * Apoio dos scripts de esquema: criar/apagar bancos DESCARTÁVEIS (fdb_*) no Postgres local e
 * rodar filhos com DB_* só no ambiente do processo (o dotenv não sobrescreve variáveis já definidas).
 * Nunca lê o .env nem toca em bancos que não comecem com fdb_.
 */
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const { Client } = require('pg');

const PSQL_BIN = process.env.PG_BIN_DIR || '/opt/homebrew/bin';
const HOST = 'localhost';
const PORT = '5432';
const RAIZ = path.join(__dirname, '..', '..');

function nomeBanco(tag) {
  return `fdb_${tag}_${crypto.randomBytes(4).toString('hex')}`;
}

function exigirDescartavel(nome) {
  if (!/^fdb_[a-z0-9_]+$/.test(nome)) throw new Error(`Recusado: ${nome} não é um banco fdb_*`);
}

function criar(nome) {
  exigirDescartavel(nome);
  execFileSync(`${PSQL_BIN}/createdb`, ['-h', HOST, '-p', PORT, nome], { stdio: 'pipe' });
}

function apagar(nome) {
  exigirDescartavel(nome);
  try {
    execFileSync(`${PSQL_BIN}/dropdb`, ['-h', HOST, '-p', PORT, '--if-exists', '--force', nome], { stdio: 'pipe' });
  } catch (e) {
    console.error(`[aviso] não consegui apagar ${nome}: ${e.message}`);
  }
}

function envDoBanco(nome) {
  exigirDescartavel(nome);
  const env = { ...process.env, DB_HOST: HOST, DB_PORT: PORT, DB_NAME: nome, DB_USER: process.env.USER || '', DB_PASSWORD: '', DB_LOGGING: 'false', DB_SSL: 'false', DATABASE_URL: '' };
  // DATABASE_URL vazio (definido) impede o dotenv de injetar uma URL do .env: o filho só enxerga o banco fdb_*.
  return env;
}

/** Roda `node <script> [args]` contra o banco informado; devolve { status, stdout, stderr }. */
function rodarNode(nome, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, args, { cwd: RAIZ, env: { ...envDoBanco(nome), ...extraEnv }, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

async function cliente(nome) {
  exigirDescartavel(nome);
  const c = new Client({ host: HOST, port: Number(PORT), database: nome, user: process.env.USER });
  await c.connect();
  return c;
}

module.exports = { nomeBanco, criar, apagar, envDoBanco, rodarNode, cliente, RAIZ };
