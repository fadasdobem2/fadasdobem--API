'use strict';

/**
 * Verificação dos MONTADORES DO SNAPSHOT `POST /lilly/context` (Maturacao/59 seções 2.1, 3, 8.2 e Maturacao/60) contra um Postgres LOCAL
 * DESCARTÁVEL: cria `fdb_lctx_<aleatório>`, migra por run-migrations, roda scripts/apoio-gf-lilly-contexto/filho.js (legado MySQL SIMULADO por
 * listas fixas em memória, banco novo real) e apaga o banco. Só dados fictícios; DB_* só no ambiente do filho; o legado nem é configurado.
 *   npm run verificar:gf-lilly-contexto
 */

const path = require('path');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const banco = pg.nomeBanco('lctx');
const vazio = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
let codigo = 1;
try {
  pg.criar(banco);
  const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], vazio);
  if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
  console.log(`Banco ${banco} criado e migrado.`);
  const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-lilly-contexto', 'filho.js')], vazio);
  process.stdout.write(f.stdout);
  if (f.status !== 0) process.stderr.write(f.stderr);
  codigo = f.status;
} catch (e) {
  console.error(e.message || e);
  codigo = 2;
} finally {
  pg.apagar(banco);
  const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_lctx_%'"], { encoding: 'utf8' }).trim();
  console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_lctx_* restante).');
}
process.exit(codigo);
