'use strict';

/**
 * Verificação da fatia Recados (Maturacao/30): mural da equipe, caixa de mensagens, respostas, leituras, notas do tarólogo e organização pessoal.
 *   1) OFFLINE (sempre): domínio contra o OURO gerado do CÓDIGO do front (`gerar-ouro-gf-recados.js`), recusas de forma, flag, gate (404 desligado,
 *      401, 405 com Allow, 403) e anúncio na sessão.
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): `fdb_rec_<aleatório>`, migra por run-migrations, roda scripts/apoio-gf-recados/filho.js.
 *   npm run verificar:gf-recados            (completo)       node scripts/verificar-gf-recados.js --offline   (sem banco; entra em verificar:legado)
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
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 300)}`); }
}

async function offline() {
  const ouro = require('./apoio-gf-recados/ouro');
  const dom = r('src/gestao-fadas/_comum/dominio/recados');
  const ap = r('src/gestao-fadas/_comum/dominio/recados-aplicar');
  console.log('Ouro do front (recados)');
  await passo('criar, editar, apagar, responder, OK, fixar, prioridade, arquivar, importância, leitura e visibilidade saem IGUAIS ao código do front', () => {
    const o = ouro.verificar();
    assert.ok(o.total >= 60, `poucos casos: ${o.total}`);
    assert.deepStrictEqual(o.falhas.slice(0, 3), []);
  });

  console.log('Regras do servidor');
  const conta = { id: 'u1', papel: 'atendente', nome: 'Khloe' };
  const agora = '2026-10-12T10:00:00.000Z';
  const raizMsg = { id: 'm1', tarotId: 'osiris', tarot: 'Osíris', text: 'Oi', at: agora, by: 'Khloe', actorId: 'u1', source: 'staff', date: '2026-10-12', subject: 'Diversos', startDate: '2026-10-12', endDate: '2026-10-12',
    delivery: { kind: 'message', audience: 'tarologist', senderId: 'u1', recipientIds: ['t1'], excludedIds: [], label: 'Osíris' } };
  await passo('o servidor carimba autor e instante: nome, actorId e at do pedido são ignorados', () => {
    const x = ap.aplicar({ antes: undefined, pedido: { ...raizMsg, by: 'Hacker', actorId: 'zzz', at: '2000-01-01T00:00:00.000Z' }, conta, agora: '2026-10-12T11:00:00.000Z', todas: [] });
    assert.equal(x.item.by, 'Khloe'); assert.equal(x.item.actorId, 'u1'); assert.equal(x.item.at, '2026-10-12T11:00:00.000Z');
  });
  await passo('campo imutável (texto de outro tarólogo, delivery, autor) é recusado com a mensagem do front', () => {
    const antes = { ...raizMsg };
    assert.throws(() => ap.aplicar({ antes, pedido: { ...raizMsg, tarotId: 'nyx' }, conta, agora, todas: [antes] }), (e) => e instanceof dom.RecadoInvalidoError && /identificar/.test(e.message));
    assert.throws(() => ap.aplicar({ antes, pedido: { ...raizMsg, delivery: { ...raizMsg.delivery, recipientIds: ['t1', 't2'] } }, conta, agora, todas: [antes] }), dom.RecadoInvalidoError);
  });
  await passo('só quem enviou edita; o histórico de revisões só cresce', () => {
    const antes = { ...raizMsg, delivery: { ...raizMsg.delivery, kind: 'board', audience: 'staff', recipientIds: ['u1', 'u2'] } };
    const outra = { id: 'u2', papel: 'supervisora', nome: 'Sup' };
    const edicao = { ...antes, text: 'Novo', updatedAt: '2026-10-12T10:05:00.000Z', revisions: [{ version: agora, text: 'Oi', at: '2026-10-12T10:05:00.000Z', by: 'Sup' }] };
    assert.throws(() => ap.aplicar({ antes, pedido: edicao, conta: outra, agora, todas: [antes] }), /não pode ser editada/);
    assert.throws(() => ap.aplicar({ antes, pedido: { ...edicao, revisions: [] }, conta, agora, todas: [antes] }), /histórico/);
    const x = ap.aplicar({ antes, pedido: edicao, conta, agora: '2026-10-12T10:06:00.000Z', todas: [antes] });
    assert.equal(x.item.text, 'Novo'); assert.equal(x.item.updatedAt, '2026-10-12T10:06:00.000Z'); assert.equal(x.item.revisions[0].by, 'Khloe');
  });
  await passo('a taróloga não vê o quadro da equipe nem a mensagem de outra; fixar e arquivar são só da própria conta', () => {
    const taro = { id: 't1', papel: 'tarologa', tarotId: 'osiris' };
    const quadro = { ...raizMsg, id: 'q1', delivery: { ...raizMsg.delivery, kind: 'board', audience: 'staff' } };
    assert.equal(dom.visivel(quadro, taro), false); assert.equal(dom.visivel(raizMsg, taro), true);
    assert.equal(dom.visivel(raizMsg, { id: 't9', papel: 'tarologa', tarotId: 'nyx' }), false);
    const x = ap.aplicar({ antes: raizMsg, pedido: { ...raizMsg, pinnedByAccount: { u1: { at: agora }, outra: { at: agora } } }, conta, agora, todas: [raizMsg] });
    assert.ok(x.pessoal.fixado); assert.equal(x.pessoal.prioridade, undefined); assert.equal(x.item.text, 'Oi');
    const item = dom.montar(raizMsg, [{ id_conta: 'u1', fixado_em: agora }, { id_conta: 'u2', prioridade_em: agora }], 'u1');
    assert.ok(item.pinnedByAccount.u1); assert.equal(item.prioritizedByAccount, undefined);
  });

  console.log('Gate e flags');
  const { criarGate } = r('src/gestao-fadas/gate');
  let sessao = { status: 'absent' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => sessao }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const chamar = async (metodo, p, corpoJson) => {
    const resp = await fetch(`http://127.0.0.1:${srv.address().port}/api${p}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpoJson === undefined || metodo === 'GET' ? undefined : JSON.stringify(corpoJson) });
    const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, h: resp.headers };
  };
  const antes = process.env.GF_FATIA_RECADOS;
  try {
    delete process.env.GF_FATIA_RECADOS;
    await passo('fatia desligada: /notes responde 404 NOT_FOUND antes do método e da sessão', async () => {
      for (const [m, p] of [['GET', '/notes'], ['PUT', '/notes/x1'], ['DELETE', '/notes']]) { const x = await chamar(m, p, {}); assert.equal(x.status, 404, `${m} ${p}`); assert.equal(x.j.error.code, 'NOT_FOUND'); }
    });
    process.env.GF_FATIA_RECADOS = 'true';
    await passo('ligada, sem sessão: 401; método errado: 405 com Allow', async () => {
      assert.equal((await chamar('GET', '/notes')).status, 401); assert.equal((await chamar('PUT', '/notes/x1', {})).status, 401);
      assert.equal((await chamar('POST', '/notes')).h.get('allow'), 'GET'); assert.equal((await chamar('GET', '/notes/x1')).h.get('allow'), 'PUT');
    });
    await passo('taróloga SEM tarotId e perfis sem permissão levam 403', async () => {
      sessao = { status: 'identity', identity: { userId: 'u-1', role: 'tarologa', displayName: 'Osíris' }, sessionId: 's1' };
      assert.equal((await chamar('GET', '/notes')).status, 403);
    });
  } finally {
    if (antes === undefined) delete process.env.GF_FATIA_RECADOS; else process.env.GF_FATIA_RECADOS = antes;
    srv.close();
  }
  await passo('a sessão anuncia `notes` só com GF_FATIA_RECADOS=true (retrocompatível)', () => {
    const fonte = require('fs').readFileSync(path.join(raiz, 'src/gestao-fadas/gate/sessao-nativa.js'), 'utf8');
    assert.match(fonte, /recadosLigado\(env\) \? \{ notes: true \} : \{\}/);
  });
}

async function comBanco() {
  const banco = pg.nomeBanco('rec');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-recados', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_rec_%'"]).toString().trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_rec_* restante).');
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
