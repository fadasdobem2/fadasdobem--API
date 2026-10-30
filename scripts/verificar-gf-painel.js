'use strict';

/**
 * Verificação da fatia Painel (Maturacao/29 seção 11): fila geral (reservas, encaminhar, liberar), admissão do turno e solicitações,
 * relógio do servidor nos eventos da Agenda, regras de início (continuação reservada, reserva da fila geral, turno confirmado) e as
 * fontes completas de `GET /api/panel/sources`.
 *   1) OFFLINE (sempre): domínio contra o OURO gerado do CÓDIGO do front (`gerar-ouro-gf-fila-geral.js`), relógio do servidor no delta,
 *      validação das entradas, flags, gate (404 desligado, 401, 405 com Allow).
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): `fdb_pnl_<aleatório>`, migra por run-migrations, roda scripts/apoio-gf-painel/filho.js.
 *   npm run verificar:gf-painel            (completo)       node scripts/verificar-gf-painel.js --offline   (sem banco; entra em verificar:legado)
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
const rejeita = (fn, status, codigo) => assert.throws(fn, (e) => e.statusCode === status && e.dados.codigo === codigo, `esperava ${status} ${codigo}`);

async function offline() {
  const ouro = require('./apoio-gf-painel/ouro');
  const delta = r('src/gestao-fadas/_comum/dominio/agenda-delta');
  const regras = r('src/gestao-fadas/_comum/dominio/agenda-regras');
  const fila = r('src/gestao-fadas/features/agenda/agenda-fila.service');
  const ator = { nome: 'Khloe', id: 'u1', perfil: 'atendente' };
  const item = (extra = {}) => ({ id: 'ag-1', tarotId: 'afila', clientId: '900013', client: 'Cliente', date: '2026-11-10', time: '10:00', channel: 'WhatsApp', position: 1, response: 'Aguardando resposta', contact: { attempt: 1, date: '2026-11-10', tags: [] }, ...extra });

  console.log('Ouro do front (fila geral, admissão, presença)');
  await passo('reservas, conflito, liberar, reservar, encaminhar, continuação, admissão e início saem IGUAIS ao código do front', () => {
    const o = ouro.verificar();
    assert.ok(o.total > 2500, `poucos casos: ${o.total}`);
    assert.deepStrictEqual(o.falhas.slice(0, 3), []);
  });

  console.log('Relógio do servidor');
  await passo('o instante do navegador vira o do servidor em todo lugar do comando (evento novo e campo do item)', () => {
    const navegador = '2026-11-10T10:00:00.000Z'; const servidor = new Date('2026-11-10T10:05:00.000Z');
    const evento = { id: 'e1', actor: 'x', at: navegador, date: '2026-11-10', attempt: 1, tag: 'Avisada', active: true, before: [], after: ['Avisada'] };
    const x = delta.aplicarDelta(item({ tarotId: 'osiris' }), { set: { contact: { attempt: 1, date: '2026-11-10', tags: ['Avisada'] }, workflowStatus: 'Avisada', queueDeferral: { attempt: 1, at: navegador, by: 'x' } }, append: { contactHistory: [evento] } }, 'contato', ator, servidor);
    assert.equal(x.item.contactHistory[0].at, servidor.toISOString());
    assert.equal(x.item.queueDeferral.at, servidor.toISOString());
    assert.equal(x.item.contactHistory[0].actor, 'Khloe');
  });
  await passo('só o instante da ação muda: outros textos e datas ficam como vieram', () => {
    const x = delta.aplicarDelta(item(), { set: { observation: 'Chamar 2026-11-10T10:00:00.000Z' } }, 'observacoes', ator, new Date('2026-11-10T11:00:00.000Z'));
    assert.equal(x.item.observation, 'Chamar 2026-11-10T10:00:00.000Z');
  });
  await passo('reservar uma taróloga por delta é recusado (é do encaminhamento); limpar a reserva continua valendo', () => {
    const reserva = { tarotId: 'osiris', at: '2026-11-10T10:00:00.000Z', by: 'x' };
    assert.throws(() => delta.aplicarDelta(item(), { set: { queueReservation: reserva } }, 'contato', ator), (e) => e instanceof regras.ErroDeRegra && /encaminhamento da Fila Geral/.test(e.message));
    const com = item({ queueReservation: reserva });
    delta.aplicarDelta(com, { unset: ['queueReservation'] }, 'contato', ator);
    delta.aplicarDelta(com, { set: { queueReservation: reserva }, append: {} }, 'contato', ator, new Date(reserva.at)); // igual ao que já existe: não é reserva nova
  });

  console.log('Validação das entradas');
  await passo('encaminhar: tarotId, mode e versão; liberar: motivo da lista', () => {
    const k = 'chave-0001';
    assert.deepStrictEqual(fila.corpo({ operationKey: k, expectedVersion: 2, tarotId: 'osiris' }, { destino: true }), { operationKey: k, expectedVersion: 2, tarotId: 'osiris', mode: 'reserve' });
    rejeita(() => fila.corpo({ operationKey: k, expectedVersion: 2, tarotId: 'osiris', mode: 'x' }, { destino: true }), 400, 'INVALID_INPUT');
    rejeita(() => fila.corpo({ operationKey: k, expectedVersion: 0, tarotId: 'osiris' }, { destino: true }), 400, 'INVALID_INPUT');
    rejeita(() => fila.corpo({ operationKey: k, expectedVersion: 1, reason: 'x' }, { destino: false }), 400, 'INVALID_INPUT');
    assert.equal(fila.corpo({ operationKey: k, expectedVersion: 1, reason: 'unavailable', notified: true }, { destino: false }).notified, true);
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
  const antes = process.env.GF_FATIA_AGENDA;
  try {
    delete process.env.GF_FATIA_AGENDA;
    await passo('fatia desligada: admissions, requests, route-general e release respondem 404 NOT_FOUND', async () => {
      for (const [m, p] of [['GET', '/agenda/admissions'], ['POST', '/agenda/admissions'], ['GET', '/agenda/requests'], ['POST', '/agenda/requests'], ['POST', '/agenda/ag-1/route-general'], ['POST', '/agenda/ag-1/reservation/release']]) {
        const x = await chamar(m, p, {});
        assert.equal(x.status, 404, `${m} ${p}`); assert.equal(x.j.error.code, 'NOT_FOUND');
      }
    });
    process.env.GF_FATIA_AGENDA = 'true';
    await passo('ligada, sem sessão: 401; método errado: 405 com Allow', async () => {
      for (const [m, p] of [['GET', '/agenda/admissions'], ['POST', '/agenda/requests'], ['POST', '/agenda/ag-1/route-general'], ['POST', '/agenda/requests/x/resolve']]) assert.equal((await chamar(m, p, {})).status, 401, `${m} ${p}`);
      assert.equal((await chamar('GET', '/agenda/ag-1/route-general')).h.get('allow'), 'POST');
      assert.equal((await chamar('DELETE', '/agenda/admissions')).h.get('allow'), 'GET, POST');
      assert.equal((await chamar('PUT', '/agenda/requests')).h.get('allow'), 'GET, POST');
    });
    await passo('taróloga: 403 em admissões, encaminhar e liberar; só ela pode pedir (a equipe leva 403 em POST /agenda/requests)', async () => {
      sessao = { status: 'identity', identity: { userId: 'u-1', role: 'tarologa', displayName: 'Osíris', tarotId: 'osiris' }, sessionId: 's1' };
      for (const [m, p] of [['GET', '/agenda/admissions'], ['POST', '/agenda/admissions'], ['GET', '/agenda/requests'], ['POST', '/agenda/ag-1/route-general'], ['POST', '/agenda/ag-1/reservation/release'], ['POST', '/agenda/requests/x/resolve']]) assert.equal((await chamar(m, p, {})).status, 403, `${m} ${p}`);
      sessao = { status: 'identity', identity: { userId: 'u-2', role: 'atendente', displayName: 'Khloe' }, sessionId: 's2' };
      assert.equal((await chamar('POST', '/agenda/requests', {})).status, 403);
    });
  } finally {
    if (antes === undefined) delete process.env.GF_FATIA_AGENDA; else process.env.GF_FATIA_AGENDA = antes;
    srv.close();
  }
  await passo('a sessão anuncia `panel` só com GF_FATIA_PAINEL=true (retrocompatível)', () => {
    const fonte = require('fs').readFileSync(path.join(raiz, 'src/gestao-fadas/gate/sessao-nativa.js'), 'utf8');
    assert.match(fonte, /painelLigado\(env\) \? \{ panel: true \} : \{\}/);
  });
}

async function comBanco() {
  const banco = pg.nomeBanco('pnl');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-painel', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_pnl_%'"]).toString().trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_pnl_* restante).');
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
