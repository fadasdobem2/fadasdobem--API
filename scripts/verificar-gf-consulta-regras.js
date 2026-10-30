'use strict';

/**
 * Verificação das REGRAS da consulta no servidor (Maturacao/38): o servidor calcula, decide e recusa como o código do front.
 *   1) OFFLINE (sempre): domínio portado contra o OURO gerado do código real do front (vínculos de bônus/complemento e compensação,
 *      conferência de encerramento, desfechos, autorização da supervisora no lançamento, correção de tempo com bônus/complemento).
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): `fdb_crg_<aleatório>`, migra, roda scripts/apoio-gf-consulta/regras/filho.js (HTTP do gate:
 *      o registro do front é aceito e o do servidor é gravado; mutantes recusados; autorização no lançamento; 409; idempotência) e apaga o banco.
 *   npm run verificar:gf-consulta-regras        node scripts/verificar-gf-consulta-regras.js --offline
 */

const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

let ok = 0;
const falhas = [];
async function passo(nome, fn) {
  try { const extra = await fn(); ok += 1; console.log(`  ok  ${nome}${extra ? ` (${extra})` : ''}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 400)}`); }
}
const resumoDe = (r) => (r.falhas.length ? `${r.falhas.length} falhas: ${r.falhas.slice(0, 5).join(' | ')}` : '');
const exigir = (r) => { if (r.falhas.length) throw new Error(resumoDe(r)); };

async function offline() {
  console.log('Ouro do código real do front');
  await passo('correção de tempo: bônus e complemento agora conferidos (0 casos fora)', () => {
    const r = require('./apoio-gf-consulta/ouro-correcao').verificar(); exigir(r); assert.equal(r.naoPortados, 0); return `${r.ok} conferências`;
  });
  await passo('vínculos de bônus, cortesia e complemento + compensação (validateMinuteBenefits, validateComplementChanges, compensation*)', () => {
    const r = require('./apoio-gf-consulta/regras/ouro-vinculos').verificar(); exigir(r); assert.ok(Object.keys(r.mensagens).length >= 20); return `${r.ok} conferências, ${r.aceitas} aceitas, ${Object.keys(r.mensagens).length} frases de recusa`;
  });
  await passo('conferência de encerramento (approveReportedFinish, decisão dos adicionais, recusar correção, benefícios, avaliação)', () => {
    const r = require('./apoio-gf-consulta/regras/ouro-conferencia').verificar(); exigir(r); return `${r.ok} conferências, ${r.resumo.aceitas} aceitas, ${Object.keys(r.resumo.recusas).length} frases de recusa`;
  });
  await passo('desfechos (cancelar, anular, queixa, decisão do cancelamento, erro de lançamento)', () => {
    const r = require('./apoio-gf-consulta/regras/ouro-desfechos').verificar(); exigir(r); return `${r.ok} conferências, ${r.aceitas} aceitas, ${Object.keys(r.mensagens).length} frases de recusa`;
  });
  await passo('autorização da supervisora no lançamento (clientFinancialLaunchError)', () => {
    const r = require('./apoio-gf-consulta/regras/ouro-autorizacao').verificar(); exigir(r); return `${r.ok} conferências, ${r.recusas} recusas`;
  });
  await passo('cobrança da edição (resolveConsultationTariff, priceNewConsultation, repriceChangedComplement, maximumAtRecordedStart, billing, minuteValue)', () => {
    const r = require('./apoio-gf-consulta/regras/ouro-edicao').verificar(); exigir(r); assert.ok(r.recusasDoMutante > 100); return `${r.ok} conferências, ${r.aceitas} aceitas, ${r.recusasDoMutante} mutantes recusados`;
  });
  console.log('Comandos refeitos pelo servidor');
  await passo('regras sem banco (encerramento da equipe, edição, leitura do comando)', () => {
    const r = require('./apoio-gf-consulta/regras/unitarios').verificar(); exigir(r); return `${r.ok} conferências`;
  });
}

async function comBanco() {
  const banco = pg.nomeBanco('crg');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-consulta', 'regras', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) { console.error(e.message || e); codigo = 2; } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_crg_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_crg_* restante).');
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
