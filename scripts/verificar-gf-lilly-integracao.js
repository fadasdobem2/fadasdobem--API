'use strict';

/**
 * Verificação de INTEGRAÇÃO ponta a ponta: o serviço Lilly REAL (clone somente leitura da Nice: FadasAdapter e LillyRuntime) contra o router
 * REAL desta API (criarRotasLilly) num Express local, com Postgres LOCAL DESCARTÁVEL (`fdb_lillyi_<aleatório>`, migrado por run-migrations), legado
 * MySQL SIMULADO, Umbler e IA FALSAS. O código da Lilly NÃO é copiado: é importado por caminho (LILLY_SERVER_DIR, padrão o clone da Nice).
 *   npm run verificar:gf-lilly-integracao
 */

const path = require('path');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const banco = pg.nomeBanco('lillyi');
const vazio = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
let codigo = 1;
try {
  pg.criar(banco);
  const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], vazio);
  if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
  console.log(`Banco ${banco} criado e migrado.`);
  const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-lilly-integracao', 'filho.js')], vazio);
  process.stdout.write(f.stdout);
  if (f.status !== 0) process.stderr.write(f.stderr);
  codigo = f.status;
} catch (e) {
  console.error(e.message || e);
  codigo = 2;
} finally {
  pg.apagar(banco);
  const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_lillyi_%'"], { encoding: 'utf8' }).trim();
  console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_lillyi_* restante).');
}
process.exit(codigo);
