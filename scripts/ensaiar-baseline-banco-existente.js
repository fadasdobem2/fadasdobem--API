'use strict';
/**
 * Ensaio do runner de migrações (scripts/run-migrations.js) sobre bancos que JÁ têm tabelas e dados.
 * Só Postgres local descartável (fdb_*), apagado ao fim. Casos:
 *   a) banco totalmente migrado: migrar de novo não aplica nada e não muda esquema nem linhas;
 *   b) banco criado só pelos models (sem _schema_migrations): o runner aplica tudo, sem erro e sem perder linhas;
 *   c) banco parcialmente migrado (primeiras N migrações) para N variados: o runner aplica o resto;
 *   d) banco "de produção" simulado (todas as migrações antigas + dados em várias tabelas): migra sem alterar linhas.
 * `--historico`: monta o estado inicial como o dos bancos antigos (baseline com models SEM o que as migrações
 * posteriores criam por SQL), em vez do sync dos models atuais. O runner testado é sempre o desta árvore.
 * A migração alinhar-models-e-migracoes e as posteriores nunca entram no estado inicial: é o que o banco existente recebe.
 * Saída 1 se algum caso falhar (erro, migração reaplicada indevidamente, linha perdida ou alterada).
 */
const fs = require('fs');
const path = require('path');
const pg = require('./apoio-esquema/pg');
const { fotografar, diferencas } = require('./apoio-esquema/snapshot');
const { popular, fotografarLinhas, compararLinhas } = require('./apoio-esquema/dados-ensaio');

const historico = process.argv.includes('--historico');
const extra = historico ? ['--historico'] : [];
const migrar = path.join(__dirname, 'apoio-esquema', 'migrar-ate.js');
const arquivos = fs.readdirSync(path.join(pg.RAIZ, 'migrations')).filter((f) => f.endsWith('.js')).sort();
const nAtuais = arquivos.length;
// Banco "existente" = tudo que veio ANTES da migração de alinhamento (ela e as seguintes são as pendentes).
const nIniciais = arquivos.findIndex((f) => f.startsWith('20261029120000-alinhar'));

// Mudanças legítimas das migrações antigas sobre linhas já existentes (renomear/remover/converter colunas).
const PERMITIDAS = ['sessions.provider', 'sessions.channel_name', 'sessions.rtc_live_status', 'sessions.telecom_status',
  'sessions.free_minutes_used', 'sessions.paid_minutes_used', 'specialists.years_experience'];

// Diferenças inócuas esperadas contra o banco de referência: defaults só-SQL e comentários só dos models.
const TOLERA = { toleraDefaultsSql: true };
const falhas = [];
const dbs = [];
async function banco(tag) { const n = pg.nomeBanco(tag); pg.criar(n); dbs.push(n); return n; }
async function com(db, fn) { const c = await pg.cliente(db); try { return await fn(c); } finally { await c.end(); } }
const ok = (caso, msg) => console.log(`  ok    [${caso}] ${msg}`);
const falha = (caso, msg) => { falhas.push(`[${caso}] ${msg}`); console.log(`  FALHA [${caso}] ${msg}`); };
const runner = (db) => pg.rodarNode(db, [path.join(pg.RAIZ, 'scripts/run-migrations.js')]);
const aplicadas = (r) => (r.stdout.match(/aplicando/g) || []).length;

async function verificarLinhas(caso, db, antes) {
  const depois = await com(db, fotografarLinhas);
  const dif = compararLinhas(antes, depois, PERMITIDAS);
  const total = Object.values(antes).reduce((s, l) => s + l.length, 0);
  if (dif.length) dif.slice(0, 8).forEach((d) => falha(caso, `linhas: ${d}`)); else ok(caso, `${total} linhas em ${Object.keys(antes).length} tabelas preservadas`);
}

async function esquemaOficial() {
  const db = await banco('ref');
  const r = runner(db);
  if (r.status !== 0) throw new Error(`migração de referência falhou: ${r.stderr}`);
  return com(db, fotografar);
}

async function casoA(ref) {
  const db = await banco('a');
  let r = runner(db);
  if (r.status !== 0) return falha('a', `1a migração falhou: ${r.stderr.slice(0, 300)}`);
  await com(db, (c) => popular(c, 3));
  const [f1, l1] = await com(db, async (c) => [await fotografar(c), await fotografarLinhas(c)]);
  r = runner(db);
  if (r.status !== 0) return falha('a', `2a migração falhou: ${r.stderr.slice(0, 300)}`);
  aplicadas(r) === 0 ? ok('a', 'migrar de novo: nada a fazer (0 migrações aplicadas)') : falha('a', `reaplicou ${aplicadas(r)} migrações`);
  const f2 = await com(db, fotografar);
  const d = diferencas(f1, f2);
  d.length ? falha('a', `esquema mudou: ${d[0]}`) : ok('a', 'esquema idêntico antes/depois');
  await verificarLinhas('a', db, l1);
  const n = await com(db, async (c) => Number((await c.query('SELECT count(*) FROM _schema_migrations')).rows[0].count));
  n === nAtuais ? ok('a', `_schema_migrations com ${n} registros`) : falha('a', `_schema_migrations tem ${n}, esperado ${nAtuais}`);
  const dr = diferencas(f2, ref);
  dr.length ? falha('a', `difere do banco de referência: ${dr[0]}`) : ok('a', 'igual ao banco de referência (migração em banco vazio)');
}

async function casoB(ref) {
  const db = await banco('b');
  const r0 = pg.rodarNode(db, [migrar, '1', pg.RAIZ, '--sem-registro', ...extra]); // baseline = sync dos models, sem registro
  if (r0.status !== 0) return falha('b', `criação por sync falhou: ${r0.stderr.slice(0, 300)}`);
  const sem = await com(db, async (c) => (await c.query(`SELECT to_regclass('public._schema_migrations') IS NULL AS s`)).rows[0].s);
  sem ? ok('b', 'banco criado só por models, sem _schema_migrations') : falha('b', 'tinha _schema_migrations');
  await com(db, (c) => popular(c, 3));
  const l1 = await com(db, fotografarLinhas);
  const r = runner(db);
  if (r.status !== 0) return falha('b', `runner falhou: ${r.stderr.slice(0, 400)}`);
  aplicadas(r) === nAtuais ? ok('b', `runner aplicou as ${nAtuais} migrações sem erro`) : falha('b', `aplicou ${aplicadas(r)} de ${nAtuais}`);
  await verificarLinhas('b', db, l1);
  const dr = diferencas(await com(db, fotografar), ref, 'resultado', 'referencia', TOLERA);
  console.log(`        (info) diferenças de esquema vs banco de referência: ${dr.length}${dr.length ? ' ex.: ' + dr[0].slice(0, 140) : ''}`);
}

async function casoC(N, ref, linhasPorTabela = 3, caso = 'c') {
  const db = await banco(caso);
  const r0 = pg.rodarNode(db, [migrar, String(N), pg.RAIZ, ...extra]);
  if (r0.status !== 0) return falha(caso, `N=${N}: criação do estado parcial falhou: ${r0.stderr.slice(0, 300)}`);
  await com(db, (c) => popular(c, linhasPorTabela));
  const l1 = await com(db, fotografarLinhas);
  const r = runner(db);
  if (r.status !== 0) return falha(caso, `N=${N}: runner falhou: ${r.stderr.slice(0, 400)}`);
  const esperado = nAtuais - Math.min(N, nIniciais);
  const dif = compararLinhas(l1, await com(db, fotografarLinhas), PERMITIDAS);
  const dr = diferencas(await com(db, fotografar), ref, 'resultado', 'referencia', TOLERA);
  const resumo = `N=${N}: aplicou ${aplicadas(r)} (esperado ${esperado}), linhas ${dif.length ? 'ALTERADAS' : 'preservadas'}, esquema vs ref: ${dr.length} dif.`;
  if (aplicadas(r) !== esperado || dif.length) { falha(caso, resumo); dif.slice(0, 5).forEach((d) => console.log('        ' + d)); } else ok(caso, resumo);
  if (dr.length) console.log(`        (info) ex.: ${dr[0].slice(0, 150)}`);
}

(async () => {
  console.log(`Ensaio de baseline em banco existente (estado inicial: ${historico ? 'histórico (sem o que as migrações criam por SQL)' : 'sync dos models atuais'}; ${nIniciais} migrações iniciais, ${nAtuais} atuais)`);
  try {
    const ref = await esquemaOficial();
    console.log('caso a) totalmente migrado'); await casoA(ref);
    console.log('caso b) criado só pelos models'); await casoB(ref);
    console.log('caso c) parcialmente migrado');
    for (const N of [1, 2, 3, 6, 9, 12, 15, 18, 20, 22, 24, nIniciais]) await casoC(N, ref);
    console.log('caso d) banco de produção simulado (muitos dados)'); await casoC(nIniciais, ref, 8, 'd');
  } catch (e) {
    falha('geral', e.message);
  } finally {
    dbs.forEach(pg.apagar);
  }
  console.log(falhas.length ? `\n${falhas.length} FALHA(S)` : '\nTUDO OK');
  process.exit(falhas.length ? 1 : 0);
})();
