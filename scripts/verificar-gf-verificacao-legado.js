'use strict';

/**
 * Verificação da TRAVA DA FICHA DO ASP (Maturacao/53): conferência pós-gravação do que o painel grava no legado.
 *   1) OFFLINE (sempre): decisão pura (a/b/c e repetição), política, flags, etapas, e o app.js (job registrado, sem outro mecanismo).
 *   2) POSTGRES DESCARTÁVEL `fdb_ver_*` (sem `--offline`): migra e roda apoio-gf-verificacao-legado/filho.js (HTTP do gate + legado FALSO em memória).
 *   A prova contra o MySQL de dev (cópias temporárias InnoDB) é `npm run ensaiar:gf-verificacao-legado`.
 *   npm run verificar:gf-verificacao-legado     node scripts/verificar-gf-verificacao-legado.js --offline
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const r = (p) => require(path.join(raiz, p));
let ok = 0; const falhas = [];
async function passo(nome, fn) { try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 400)}`); } }

async function offline() {
  const v = r('src/gestao-fadas/legado-escrita/verificacao');
  const D = v.decidir;
  console.log('Decisão (pura)');
  await passo('(a) igual ao que gravamos: ok, mesmo se o valor antigo for igual (vazio e nulo contam como iguais)', () => {
    assert.deepEqual(D({ atual: 'Novo', antigo: 'Velho', novo: 'Novo' }), { acao: 'ok', tipo: 'igual_ao_gravado' });
    assert.equal(D({ atual: null, antigo: 'X', novo: '' }).acao, 'ok');
    assert.equal(D({ atual: '1980-03-05 00:00:00', antigo: '1972-01-13 00:00:00', novo: '1980-03-05 00:00:00' }).acao, 'ok');
  });
  await passo('(b) voltou EXATAMENTE ao valor antigo: reaplica; de novo depois da reaplicação: divergente (não reaplica mais)', () => {
    assert.deepEqual(D({ atual: 'Velho', antigo: 'Velho', novo: 'Novo' }), { acao: 'reaplicar', tipo: 'voltou_ao_valor_antigo' });
    assert.deepEqual(D({ atual: 'Velho', antigo: 'Velho', novo: 'Novo', reaplicada: true }), { acao: 'divergente', tipo: 'voltou_ao_valor_antigo_de_novo' });
    assert.equal(D({ atual: 'velho', antigo: 'Velho', novo: 'Novo' }).tipo, 'valor_diferente', 'diferença de maiúscula não é "exatamente" o antigo');
  });
  await passo('(c) outro valor (nem antigo nem novo): divergente, nunca reaplica, com ou sem reaplicação anterior', () => {
    for (const reaplicada of [false, true]) assert.deepEqual(D({ atual: 'Outro', antigo: 'Velho', novo: 'Novo', reaplicada }), { acao: 'divergente', tipo: 'valor_diferente' });
  });
  await passo('tarólogo (reaplica = false): voltar ao antigo só vira divergente; linha sumida no legado: divergente', () => {
    assert.deepEqual(D({ atual: 'Velho', antigo: 'Velho', novo: 'Novo', reaplica: false }), { acao: 'divergente', tipo: 'voltou_ao_valor_antigo_sem_reaplicar' });
    assert.deepEqual(D({ atual: null, antigo: 'a', novo: 'b', existe: false }), { acao: 'divergente', tipo: 'sem_registro' });
  });

  console.log('Política e flags');
  await passo('só nome_id, nome2 e datanascimento do cliente (whats NUNCA) e nmuTarologo (sem reaplicar); colunas dentro da allowlist de UPDATE', () => {
    assert.deepEqual([...v.POLITICA.clientes.colunas], ['nome_id', 'nome2', 'datanascimento']); assert.equal(v.POLITICA.clientes.reaplica, true);
    assert.deepEqual([...v.POLITICA.tarologos.colunas], ['nmuTarologo']); assert.equal(v.POLITICA.tarologos.reaplica, false);
    const se = r('src/gestao-fadas/legado-escrita/sql.entidades');
    for (const c of v.POLITICA.clientes.colunas) assert.ok(se.CAMPOS_CLIENTE.includes(c)); for (const c of v.POLITICA.tarologos.colunas) assert.ok(se.CAMPOS_TAROLOGO.includes(c));
  });
  await passo('desligada por padrão; precisa da flag própria E do espelho geral E da flag da entidade E do modo primeiro', () => {
    const g = { GF_LEGADO_ESCRITA_ENABLED: 'true', GF_LEGADO_CLIENTES: 'true', GF_LEGADO_TAROLOGOS: 'true' };
    assert.equal(v.ligada({}), false); assert.equal(v.ativa('clientes', g), false);
    assert.equal(v.ativa('clientes', { ...g, GF_LEGADO_VERIFICACAO: 'true' }), true); assert.equal(v.ativa('tarologos', { ...g, GF_LEGADO_VERIFICACAO: 'true' }), true);
    assert.equal(v.ativa('clientes', { GF_LEGADO_VERIFICACAO: 'true' }), false); assert.equal(v.ativa('clientes', { ...g, GF_LEGADO_VERIFICACAO: 'true', GF_LEGADO_CLIENTES: 'false' }), false);
    assert.equal(v.ativa('clientes', { ...g, GF_LEGADO_VERIFICACAO: 'true', GF_LEGADO_MODO: 'copia' }), false); assert.equal(v.ativa('consultas', { ...g, GF_LEGADO_VERIFICACAO: 'true' }), false);
  });
  await passo('etapas padrão +2 min, +15 min, +2 h; GF_LEGADO_VERIFICACAO_MINUTOS ajusta (lixo volta ao padrão)', () => {
    assert.deepEqual(v.etapas({}), [2, 15, 120]); assert.deepEqual(v.etapas({ GF_LEGADO_VERIFICACAO_MINUTOS: '0.5, 1' }), [0.5, 1]); assert.deepEqual(v.etapas({ GF_LEGADO_VERIFICACAO_MINUTOS: 'x,-1' }), [2, 15, 120]);
  });
  await passo('a reaplicação só existe para cliente e só pela allowlist (nenhum INSERT/DELETE no código da trava)', () => {
    for (const f of ['verificacao.js', 'verificacao.conferir.js', 'verificacao.job.js']) {
      const t = fs.readFileSync(path.join(raiz, 'src/gestao-fadas/legado-escrita', f), 'utf8');
      assert.ok(!/legado\(\)\.emTransacao[^;]*(INSERT|DELETE)/i.test(t)); assert.ok(!/\bDELETE\b/.test(t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
    }
    assert.ok(!/execute\(\s*['"`](INSERT|UPDATE|DELETE)[^'"`]*(usuarios|tbl_)/i.test(fs.readFileSync(path.join(raiz, 'src/gestao-fadas/legado-escrita/verificacao.conferir.js'), 'utf8')));
  });
  await passo('app.js registra o job da trava (um só, como o job de presença) e a flag nasce desligada nos envs versionados', () => {
    const app = fs.readFileSync(path.join(raiz, 'app.js'), 'utf8');
    assert.equal((app.match(/verificacao\.job/g) || []).length, 1); assert.ok(/GESTAO_FADAS_ENABLED === 'true'\) require\('\.\/src\/gestao-fadas\/legado-escrita\/verificacao\.job'\)\.agendar\(\)/.test(app));
    for (const rel of ['.env', '.env.example']) { const f = path.join(raiz, rel); if (fs.existsSync(f)) assert.ok(!/^\s*GF_LEGADO_VERIFICACAO\s*=\s*"?true/im.test(fs.readFileSync(f, 'utf8')), `${rel} liga a verificação`); }
    const job = r('src/gestao-fadas/legado-escrita/verificacao.job'); assert.equal(job.agendar({}), null); assert.equal(job.agendar({ GF_LEGADO_VERIFICACAO: 'true' }), null, 'sem o espelho geral não agenda');
  });
}

async function comBanco() {
  const banco = pg.nomeBanco('ver');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const fi = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-verificacao-legado', 'filho.js')], extra);
    process.stdout.write(fi.stdout);
    if (fi.status !== 0) process.stderr.write(fi.stderr);
    codigo = fi.status;
  } catch (e) { console.error(e.message || e); codigo = 2; } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_ver_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_ver_* restante).');
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
