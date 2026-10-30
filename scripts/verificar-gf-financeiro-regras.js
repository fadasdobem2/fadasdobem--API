'use strict';

/**
 * Verifica as regras financeiras de pagamento do servidor (Maturacao/42) contra o ouro do CÓDIGO REAL do front
 * (scripts/apoio-gf-financeiro-regras/ouro-*-front.json) e contra mutantes. Offline (entra em `verificar:legado`); com `DATABASE_URL`
 * descartável `fdb_fnr_*` roda também os passos HTTP (apoio-gf-financeiro-regras/filho.js).
 *   node scripts/verificar-gf-financeiro-regras.js
 */

const fs = require('node:fs');
const path = require('node:path');

const AREAS = ['movimento', 'ocorrencias', 'transferencia', 'planilha', 'compra', 'datas', 'duplicidade', 'roteador'];
let falhou = false;
for (const area of AREAS) {
  const arquivo = path.join(__dirname, 'apoio-gf-financeiro-regras', `verificar-${area}.js`);
  if (!fs.existsSync(arquivo) || (area !== 'roteador' && !fs.existsSync(path.join(__dirname, 'apoio-gf-financeiro-regras', `ouro-${area}-front.json`)))) continue;
  const r = require(arquivo).verificar();
  console.log(`ouro ${r.nome}: ${r.ok}/${r.total} conferências iguais ao código do front (${r.aceitos} aceitas, ${r.recusas} recusas com a MESMA frase)`);
  if (r.extra) console.log(r.extra);
  if (r.falhas.length) { falhou = true; console.error(`${r.falhas.length} divergências em ${r.nome}; primeiras:\n${r.falhas.slice(0, 12).join('\n')}`); }
}
if (falhou || process.argv.includes('--offline')) process.exit(falhou ? 1 : 0);

// Postgres LOCAL DESCARTÁVEL (fdb_fnr_*): HTTP do gate com GF_FINANCEIRO_REGRAS=true.
const { execFileSync } = require('node:child_process');
const pg = require('./apoio-esquema/pg');
(async () => {
  const banco = pg.nomeBanco('fnr');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-financeiro-regras', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) { console.error(e.message || e); codigo = 2; } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_fnr_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_fnr_* restante).');
  }
  process.exit(codigo);
})();
