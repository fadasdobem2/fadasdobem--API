'use strict';

/**
 * Verificação da FUNDAÇÃO DE DADOS da Lilly (Maturacao/59) contra um Postgres LOCAL DESCARTÁVEL: cria `fdb_lilly_<aleatório>`, migra por
 * run-migrations, roda scripts/apoio-gf-lilly-dados/filho.js (migração idempotente, gatilho só-acrescenta, events/resolve, guarda de
 * idempotência, conciliação, notas do horário, repositórios) e apaga o banco. Só dados fictícios; DB_* só no ambiente dos filhos.
 *   npm run verificar:gf-lilly-dados
 */

const path = require('path');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const banco = pg.nomeBanco('lilly');
const vazio = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
let codigo = 1;
try {
  pg.criar(banco);
  const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], vazio);
  if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
  console.log(`Banco ${banco} criado e migrado.`);
  const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-lilly-dados', 'filho.js')], vazio);
  process.stdout.write(f.stdout);
  if (f.status !== 0) process.stderr.write(f.stderr);
  codigo = f.status;
} catch (e) {
  console.error(e.message || e);
  codigo = 2;
} finally {
  pg.apagar(banco);
  const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_lilly_%'"], { encoding: 'utf8' }).trim();
  console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_lilly_* restante).');
}
process.exit(codigo);
