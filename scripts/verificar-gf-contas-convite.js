'use strict';

/**
 * Verificação do convite de acesso da equipe (v706), no servidor, em POSTGRES LOCAL DESCARTÁVEL (padrão de verificar-gf-contas.js):
 * cria `fdb_ctv_<aleatório>` em localhost:5432, migra por run-migrations, roda scripts/apoio-gf-contas/filho-convite.js (HTTP do gate:
 * criar por convite sem senha, token que nunca é guardado, link público sem sessão, 48 horas, uso único, gerar de novo, cancelar, e-mail do
 * Fadas, senha de 15, permissão "Ver minutagem total" com trilha) e apaga o banco. Não toca no MySQL legado nem no .env.
 *   npm run verificar:gf-contas-convite
 */

const path = require('path');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

(async () => {
  const banco = pg.nomeBanco('ctv');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-contas', 'filho-convite.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_ctv_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_ctv_* restante).');
  }
  process.exit(codigo);
})();
