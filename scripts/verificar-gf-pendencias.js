'use strict';

/**
 * Verificação da fatia Pendências (Maturacao/34).
 *   1) OFFLINE (sempre): o domínio portado contra o ouro do CÓDIGO REAL do front (`apoio-gf-pendencias/ouro.js`: `transferPending`,
 *      `reconcilePending`, `canTransferPending`, `pendingVisible`; mutantes são recusados), forma, a flag, 404 com a fatia desligada,
 *      401 sem sessão e 405 com Allow.
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): cria `fdb_pen_<aleatório>` em localhost:5432, migra por run-migrations, roda
 *      scripts/apoio-gf-pendencias/filho.js (HTTP do gate, idempotência, 409, corrida, auditoria, perfis, vínculos, fontes do Painel) e apaga o banco.
 *   npm run verificar:gf-pendencias            (completo)       node scripts/verificar-gf-pendencias.js --offline   (sem banco; entra em verificar:legado)
 */

const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const express = require('express');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const r = (p) => require(path.join(raiz, p));
let ok = 0;
const falhas = [];
async function passo(nome, fn) {
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 240)}`); }
}
const recusa = (fn, texto) => assert.throws(fn, (e) => e.name === 'PendenciaInvalidaError' && (!texto || String(e.message).includes(texto)), `esperava recusa "${texto || ''}"`);

async function offline() {
  const dom = r('src/gestao-fadas/_comum/dominio/pendencias');
  const s = { id: 'divergence:d1', occurrence: 'o1', financial: false, tone: 'divergence', title: 'T', who: 'W', detail: 'D' };
  console.log('Ouro do código real do front');
  await passo('o porte concorda com o front em chave, fila inicial, visibilidade, quem encaminha e reconciliação (ouro do código do front)', () => {
    const { verificar } = require('./apoio-gf-pendencias/ouro');
    const saida = verificar();
    assert.deepEqual(saida.falhas.slice(0, 5), []); assert.ok(saida.ok > 2000, `só ${saida.ok} conferências`);
    console.log(`        ouro pendências: ${saida.ok}/${saida.ok} conferências iguais`);
  });
  await passo('a derivação do servidor (cancelamentos, encerramentos, divergências, consultas na agenda, sem pagamento, pagamento pendente) concorda com o front e confere resolvida, reaberta e encaminhar (ouro do código do front)', () => {
    const { verificar } = require('./apoio-gf-pendencias/ouro-origem');
    const saida = verificar();
    assert.deepEqual(saida.falhas.slice(0, 5), []); assert.ok(saida.ok > 1500, `só ${saida.ok} conferências`);
    console.log(`        ouro derivação: ${saida.ok}/${saida.ok} conferências iguais`);
  });
  console.log('Forma e transições');
  await passo('forma: aceita o registro do front; recusa chave, fila, evento, snapshot e histórico ruins', () => {
    const rg = { key: JSON.stringify([s.id, s.occurrence]), snapshot: s, queue: 'atendimento', events: [] };
    dom.forma(rg);
    for (const ruim of [{ key: 'x' }, { queue: 'outra' }, { events: 'x' }, { snapshot: { ...s, financial: 'sim' } }, { snapshot: { ...s, id: '' } }, { events: [{ at: 'ontem' }] }, { resolvedAt: 'ontem' }]) recusa(() => dom.forma({ ...rg, ...ruim }));
  });
  await passo('aplicar: encaminhar vale pelo ator da sessão; evento de outro papel, motivo vazio e perfil sem permissão são recusados', () => {
    const rg = { key: JSON.stringify([s.id, s.occurrence]), snapshot: s, queue: 'supervisao', events: [{ at: '2026-10-30T10:00:00.000Z', actor: { id: 'x', name: 'x', role: 'administradora' }, action: 'forward', from: 'atendimento', to: 'supervisao', reason: 'Decida.' }] };
    const agora = '2026-10-31T00:00:00.000Z';
    const feito = dom.aplicar(null, rg, { id: 'u', nome: 'Khloe', papel: 'atendente' }, agora);
    assert.equal(feito.events[0].actor.role, 'atendente'); assert.equal(feito.events[0].at, agora);
    recusa(() => dom.aplicar(null, rg, { id: 'u', nome: 'Laya', papel: 'administradora' }, agora), 'perfil não pode');
    recusa(() => dom.aplicar(null, rg, { id: 'u', nome: 'T', papel: 'tarologa' }, agora));
    recusa(() => dom.aplicar(null, { ...rg, events: [{ ...rg.events[0], reason: ' ' }] }, { id: 'u', nome: 'K', papel: 'atendente' }, agora), 'motivo');
  });

  console.log('Gate');
  const { criarGate } = r('src/gestao-fadas/gate');
  const { pendenciasLigado } = r('src/gestao-fadas/gate/rotas-pendencias');
  let sessao = { status: 'absent' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => sessao }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const origem = `http://127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(`${origem}/api${p}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, h: resp.headers };
  };
  const antes = process.env.GF_FATIA_PENDENCIAS;
  try {
    await passo('a flag só liga com "true"', () => {
      assert.equal(pendenciasLigado({ GF_FATIA_PENDENCIAS: 'true' }), true); assert.equal(pendenciasLigado({ GF_FATIA_PENDENCIAS: '1' }), false); assert.equal(pendenciasLigado({}), false);
    });
    delete process.env.GF_FATIA_PENDENCIAS;
    await passo('desligada: GET e PUT respondem 404 NOT_FOUND antes da sessão, com no-store', async () => {
      for (const m of ['GET', 'PUT']) { const a = await chamar(m, '/pending-routing', m === 'GET' ? undefined : {}); assert.equal(a.status, 404, m); assert.equal(a.j.error.code, 'NOT_FOUND'); assert.equal(a.h.get('cache-control'), 'no-store'); }
    });
    process.env.GF_FATIA_PENDENCIAS = 'true';
    await passo('ligada, sem sessão: 401 SESSION_REQUIRED; método errado: 405 com Allow antes da sessão', async () => {
      for (const m of ['GET', 'PUT']) { const a = await chamar(m, '/pending-routing', m === 'GET' ? undefined : {}); assert.equal(a.status, 401, m); assert.equal(a.j.error.code, 'SESSION_REQUIRED'); }
      const b = await chamar('DELETE', '/pending-routing'); assert.equal(b.status, 405); assert.equal(b.h.get('allow'), 'GET, PUT');
    });
    await passo('a sessão nativa anuncia pending só quando ligada (retrocompatível)', () => {
      const fonte = require('fs').readFileSync(path.join(raiz, 'src/gestao-fadas/gate/sessao-nativa.js'), 'utf8');
      assert.match(fonte, /pendenciasLigado\(env\) \? \{ pending: true \} : \{\}/);
    });
  } finally {
    if (antes === undefined) delete process.env.GF_FATIA_PENDENCIAS; else process.env.GF_FATIA_PENDENCIAS = antes;
    srv.close();
  }
}

async function comBanco() {
  const banco = pg.nomeBanco('pen');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-pendencias', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_pen_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_pen_* restante).');
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
