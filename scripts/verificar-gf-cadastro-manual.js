'use strict';

/** POST /api/catalog/clients em Postgres local DESCARTÁVEL e legado falso somente leitura.
 * Usa o runner já existente; não lê credenciais nem conecta ao MySQL legado.
 * Execução: PG_BIN_DIR=/caminho/do/postgres node scripts/verificar-gf-cadastro-manual.js
 * Sem servidor prévio: PG_EMBEDDED_BIN_DIR=/caminho/com/initdb/postgres/pg_ctl node scripts/verificar-gf-cadastro-manual.js
 * Só cadeia HTTP e validação, com conexão SQL bloqueada: node scripts/verificar-gf-cadastro-manual.js --offline
 */
const path = require('path');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const banco = pg.nomeBanco('cmn');
const isolado = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '', LEGADO_DB_PASSWORD: '', GF_LEGADO_ESCRITA_ENABLED: 'false' };
if (process.env.PG_EMBEDDED_BIN_DIR && !process.argv.includes('--offline')) {
  require('./apoio-gf-cadastro-manual/postgres-local').rodar(banco, isolado)
    .then((codigo) => { process.exitCode = codigo; })
    .catch((e) => { console.error(e.message || e); process.exitCode = 2; });
} else {
if (process.argv.includes('--offline')) {
  const filho = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-cadastro-manual', 'offline.js')], isolado);
  process.stdout.write(filho.stdout);
  if (filho.status !== 0) process.stderr.write(filho.stderr);
  process.exit(filho.status === 0 ? 0 : 1);
}
let codigo = 1;
try {
  pg.criar(banco);
  const migracao = pg.rodarNode(banco, ['scripts/run-migrations.js'], isolado);
  if (migracao.status !== 0) throw new Error(`Migração descartável falhou:\n${migracao.stderr || migracao.stdout}`);
  console.log(`Banco descartável ${banco} criado e migrado.`);
  const filho = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-cadastro-manual', 'filho.js')], isolado);
  process.stdout.write(filho.stdout);
  if (filho.status !== 0) process.stderr.write(filho.stderr);
  codigo = filho.status === 0 ? 0 : 1;
} catch (e) {
  console.error(e.message || e);
  codigo = 2;
} finally {
  pg.apagar(banco);
  try {
    const restante = execFileSync(path.join(process.env.PG_BIN_DIR || '/opt/homebrew/bin', 'psql'),
      ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', `SELECT datname FROM pg_database WHERE datname = '${banco}'`], { encoding: 'utf8' }).trim();
    if (restante) throw new Error(`Banco descartável ainda existe: ${banco}`);
    console.log('Banco descartável apagado.');
  } catch (e) { console.error(e.message || e); codigo = 2; }
}
process.exitCode = codigo;
}
