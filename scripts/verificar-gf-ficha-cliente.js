'use strict';

/**
 * Verificação da fatia Clientes: ficha real (Maturacao/32). Não há rota nova: a ficha usa o PATCH de cliente (Cadastros), as restrições, o
 * saldo e as consultas já existentes; a fatia acrescenta a flag `GF_FATIA_CLIENTES` (anuncia `realFeatures.clients`) e o nome editado no saldo.
 *   1) OFFLINE (sempre): a flag só liga com "true"; o anúncio da sessão está no gate.
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): `fdb_cli_<aleatório>` em localhost:5432, migra por run-migrations, roda
 *      scripts/apoio-gf-ficha-cliente/filho.js e apaga o banco. DB_* só no ambiente do filho; o legado MySQL nem é configurado.
 *   npm run verificar:gf-clientes            (completo)       node scripts/verificar-gf-ficha-cliente.js --offline   (sem banco; entra em verificar:legado)
 */

const path = require('path');
const assert = require('assert');
const fs = require('fs');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const r = (p) => require(path.join(raiz, p));
let ok = 0;
const falhas = [];
async function passo(nome, fn) {
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 240)}`); }
}

async function offline() {
  const { clientesLigado } = r('src/gestao-fadas/gate/rotas-cadastros');
  console.log('Flag');
  await passo('GF_FATIA_CLIENTES liga só com "true"', () => {
    assert.equal(clientesLigado({ GF_FATIA_CLIENTES: 'true' }), true);
    assert.equal(clientesLigado({ GF_FATIA_CLIENTES: ' TRUE ' }), true);
    assert.equal(clientesLigado({ GF_FATIA_CLIENTES: '1' }), false);
    assert.equal(clientesLigado({}), false);
  });
  await passo('a sessão nativa anuncia `clients` e a ficha não cria migração, tabela nem escrita no legado', () => {
    const fonte = fs.readFileSync(path.join(raiz, 'src/gestao-fadas/gate/sessao-nativa.js'), 'utf8');
    assert.match(fonte, /clientesLigado\(env\) \? \{ clients: true \}/);
    assert.ok(!fs.existsSync(path.join(raiz, 'migrations/20261117000000-gestao-fadas-clientes.js')), 'sem migração própria');
  });
}

async function comBanco() {
  const banco = pg.nomeBanco('cli');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-ficha-cliente', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_cli_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_cli_* restante).');
  }
  return codigo;
}

(async () => {
  await offline();
  console.log(`\nOffline: ${ok} ok, ${falhas.length} falhas`);
  if (falhas.length) process.exit(1);
  if (process.argv.includes('--offline')) process.exit(0);
  process.exit(await comBanco());
})().catch((e) => { console.error(e); process.exit(2); });
