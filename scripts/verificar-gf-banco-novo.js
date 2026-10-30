'use strict';

/**
 * Verificação do BANCO NOVO do Gestão Fadas (Postgres da A) contra um Postgres LOCAL DESCARTÁVEL: cria `fdb_gf_<aleatório>`
 * em localhost:5432 (/opt/homebrew/bin), migra por `npm run migrate` (scripts/run-migrations.js), roda o filho
 * (scripts/apoio-gf-banco-novo/filho.js: esquema, allowlist, executor, store, leitores, HTTP, ensaio e diferencial) e apaga o
 * banco no fim. DB_* só no ambiente dos processos filhos; nunca lê o .env nem toca em outro banco.
 *   npm run verificar:gf-banco-novo
 */

const path = require('path');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const banco = pg.nomeBanco('gf');
let codigo = 1;
try {
  pg.criar(banco);
  const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' });
  if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
  console.log(`Banco ${banco} criado e migrado.`);
  const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-banco-novo', 'filho.js')], { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' });
  process.stdout.write(f.stdout);
  if (f.status !== 0) process.stderr.write(f.stderr);
  codigo = f.status;
} catch (e) {
  console.error(e.message || e);
  codigo = 2;
} finally {
  pg.apagar(banco);
  const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_gf_%'"], { encoding: 'utf8' }).trim();
  console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_gf_* restante).');
}
process.exit(codigo);
