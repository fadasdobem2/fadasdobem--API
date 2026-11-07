'use strict';

/**
 * Verificação dos EXECUTORES das ações da Lilly (Maturacao/59 seção 5 e Maturacao/60) contra um Postgres LOCAL DESCARTÁVEL: cria
 * `fdb_lillya_<aleatório>`, migra por run-migrations, roda scripts/apoio-gf-lilly-acoes/filho.js (HTTP das rotas da Lilly, legado SIMULADO,
 * nenhuma flag GF_LEGADO_* ligada) e apaga o banco. Só dados fictícios; DB_* só no ambiente dos filhos.
 *   npm run verificar:gf-lilly-acoes
 */

const path = require('path');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const banco = pg.nomeBanco('lillya');
const vazio = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
let codigo = 1;
try {
  pg.criar(banco);
  const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], vazio);
  if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
  console.log(`Banco ${banco} criado e migrado.`);
  const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-lilly-acoes', 'filho.js')], vazio);
  process.stdout.write(f.stdout);
  if (f.status !== 0) process.stderr.write(f.stderr);
  codigo = f.status;
} catch (e) {
  console.error(e.message || e);
  codigo = 2;
} finally {
  pg.apagar(banco);
  const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_lillya_%'"], { encoding: 'utf8' }).trim();
  console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_lillya_* restante).');
}
process.exit(codigo);
