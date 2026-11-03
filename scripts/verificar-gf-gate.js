'use strict';

/**
 * Verificação OFFLINE do gate (`src/gestao-fadas/gate`): sem rede externa e sem banco. Sobe o router num Express efêmero
 * (127.0.0.1, porta livre) com `provedorDeSessao` falso e confere status, corpo e cabeçalhos de erro contra o que a B
 * devolve segundo o código dela (auth-http.server.ts, real-access.server.ts). O proxy da B é provado contra uma "B" falsa
 * local. O legado aponta para uma porta fechada: leitura que chega ao banco vira 503, nunca lista vazia.
 *
 *   node scripts/verificar-gf-gate.js
 */

const assert = require('assert');
const http = require('http');
const express = require('express');
// Banco: porta fechada de propósito (o dotenv não sobrescreve variáveis já definidas). Nada é gravado em lugar nenhum.
process.env.LEGADO_DB_HOST = '127.0.0.1';
process.env.LEGADO_DB_PORT = '1';
process.env.LEGADO_DB_NAME = 'verificacao_offline';
process.env.LEGADO_DB_USER = 'verificacao';
process.env.LEGADO_DB_PASSWORD = '';
// O banco NOVO (PostgreSQL) também fica inacessível: sem isso, um `.env` de desenvolvimento com Postgres no ar faz o acordo responder 200 em vez de 503.
Object.assign(process.env, { DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'verificacao_offline', DB_USER: 'verificacao', DB_PASSWORD: '' });
delete process.env.DATABASE_URL;
delete process.env.GATE_B_ORIGEM;
// `payouts` só liga no ambiente `test` (R24); os testes de repasse abaixo rodam ligados.
process.env.FADAS_ENVIRONMENT = 'test';

const { criarGate } = require('../src/gestao-fadas/gate');
const { criarProvedorProxyB } = require('../src/gestao-fadas/gate/sessao-proxy-b');
const { encerrarLegado } = require('../src/models/legado');
const tarologosService = require('../src/gestao-fadas/features/tarologos/tarologos.service');

const TOKEN = 'A'.repeat(43);
const COOKIE = `__Host-gf_session=${TOKEN}`;
const identidade = (role) => ({ status: 'identity', sessionId: 's1', identity: { userId: '42', displayName: 'Teste', role, expiresAt: '2030-01-01T00:00:00.000Z' } });
let proxima = { status: 'absent' };
const provedorFalso = { validar: async () => proxima, login: async () => null, logout: async () => null, sessao: async () => null };

function ouvir(app) {
  return new Promise((resolve) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s)); });
}
const fechar = (s) => new Promise((r) => s.close(r));

async function chamar(base, caminho, { metodo = 'GET', cookie, corpo, cabecalhos = {} } = {}) {
  const r = await fetch(`${base}${caminho}`, { method: metodo, headers: { ...(cookie ? { cookie } : {}), ...cabecalhos }, body: corpo });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch (_e) { /* sem corpo */ }
  return { status: r.status, json, headers: r.headers, texto };
}

function conferirErro(r, status, codigo, mensagem, rotulo) {
  assert.strictEqual(r.status, status, `${rotulo}: status ${r.status} (esperado ${status}) ${r.texto}`);
  assert.deepStrictEqual(r.json, { error: { code: codigo, message: mensagem } }, `${rotulo}: corpo`);
  assert.strictEqual(r.headers.get('cache-control'), 'no-store', `${rotulo}: Cache-Control`);
  assert.strictEqual(r.headers.get('content-type'), 'application/json; charset=utf-8', `${rotulo}: Content-Type`);
  assert.strictEqual(r.headers.get('etag'), null, `${rotulo}: sem ETag`);
  assert.strictEqual(r.headers.get('x-powered-by'), null, `${rotulo}: sem X-Powered-By`);
  console.log(`  ok  ${rotulo}`);
}

const MSG_PERIODO = 'Confira o período e a página e tente novamente.';
const MSG_NEGADO = 'Esta informação não está disponível para a sua função.';
const MSG_DADOS = 'Confira os dados informados e tente novamente.';
const MSG_INDISP = 'Não foi possível acessar o serviço. Tente novamente.';

async function testarGate() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', criarGate({ provedorDeSessao: provedorFalso, verificarLegado: async () => false, extras: [
    { metodo: 'GET', caminho: '/operations/consultations/export', capacidade: 'canExportConsultations', handler: (_q, res) => res.status(200).end('extra') },
  ] }));
  app.use((_req, res) => res.status(418).end('fora do gate'));
  const srv = await ouvir(app);
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  try {
    // 1. Sessão: 401 sem cookie, 401 sessão inválida, 403 conta sem acesso, 503 provedor fora (B: sessionResponse).
    proxima = { status: 'absent' };
    conferirErro(await chamar(base, '/operations/consultations'), 401, 'SESSION_REQUIRED', 'Entre para continuar.', '401 sem sessão');
    proxima = { status: 'invalid' };
    conferirErro(await chamar(base, '/operations/consultations', { cookie: COOKIE }), 401, 'SESSION_INVALID', 'Sua sessão expirou ou foi encerrada. Entre novamente.', '401 sessão inválida');
    proxima = { status: 'access-unavailable' };
    conferirErro(await chamar(base, '/operations/tarologists', { cookie: COOKIE }), 403, 'ACCOUNT_ACCESS_UNAVAILABLE', 'Sua conta ainda não pode acessar o sistema. Procure a administração.', '403 conta sem acesso');
    proxima = { status: 'unavailable' };
    conferirErro(await chamar(base, '/payouts/openings/7', { cookie: COOKIE }), 503, 'SERVICE_UNAVAILABLE', MSG_INDISP, '503 sessão indisponível');

    // 2. Método: 405 + Allow antes da sessão.
    proxima = { status: 'absent' };
    const m = await chamar(base, '/operations/consultations', { metodo: 'POST', corpo: '{}', cabecalhos: { 'content-type': 'application/json' } });
    conferirErro(m, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', '405 método');
    assert.strictEqual(m.headers.get('allow'), 'GET');

    // 3. Permissão por perfil (canReadRealOperations: só administradora e assistente).
    for (const rota of ['/operations/consultations', '/operations/receipts', '/operations/receipts/undated', '/operations/tarologists']) {
      for (const perfil of ['supervisora', 'atendente', 'tarologa']) {
        proxima = identidade(perfil);
        conferirErro(await chamar(base, rota, { cookie: COOKIE }), 403, 'ACCESS_DENIED', MSG_NEGADO, `403 ${perfil} em ${rota}`);
      }
    }
    proxima = identidade('atendente');
    conferirErro(await chamar(base, '/payouts/agreements/7', { cookie: COOKIE }), 403, 'ACCESS_DENIED', MSG_NEGADO, '403 atendente em repasse (leitura)');
    proxima = identidade('tarologa');
    conferirErro(await chamar(base, '/operations/clients', { cookie: COOKIE }), 403, 'ACCESS_DENIED', MSG_NEGADO, '403 tarologa em clientes (canReadRealClients)');
    conferirErro(await chamar(base, '/operations/clients/1', { cookie: COOKIE }), 403, 'ACCESS_DENIED', MSG_NEGADO, '403 tarologa na ficha');

    // 4. Validação (depois da permissão, antes do banco): 400 com o texto de período/página; repasse com o texto de gravação.
    proxima = identidade('administradora');
    conferirErro(await chamar(base, '/operations/consultations?start=2026-13-40', { cookie: COOKIE }), 400, 'INVALID_INPUT', MSG_PERIODO, '400 data inválida (consultas)');
    conferirErro(await chamar(base, '/operations/consultations?start=2026-01-01&end=2026-01-01&page=0', { cookie: COOKIE }), 400, 'INVALID_INPUT', MSG_PERIODO, '400 página 0');
    conferirErro(await chamar(base, '/operations/receipts?by=outro', { cookie: COOKIE }), 400, 'INVALID_INPUT', MSG_PERIODO, '400 by inválido (recebimentos)');
    conferirErro(await chamar(base, '/operations/clients/abc', { cookie: COOKIE }), 400, 'INVALID_INPUT', MSG_PERIODO, '400 id de cliente inválido');
    conferirErro(await chamar(base, '/payouts/agreements/007', { cookie: COOKIE }), 400, 'INVALID_INPUT', MSG_DADOS, '400 tarotId inválido (acordo)');
    conferirErro(await chamar(base, '/payouts/openings/abc', { cookie: COOKIE }), 400, 'INVALID_INPUT', MSG_DADOS, '400 ref inválido (abertura)');

    // 5. Legado fora: 503 no formato da B, nunca lista vazia. (porta fechada, sem gravar nada)
    proxima = identidade('assistente');
    conferirErro(await chamar(base, '/operations/consultations?start=2026-01-01&end=2026-01-02', { cookie: COOKIE }), 503, 'SERVICE_UNAVAILABLE', MSG_INDISP, '503 consultas sem banco');
    conferirErro(await chamar(base, '/operations/receipts/undated', { cookie: COOKIE }), 503, 'SERVICE_UNAVAILABLE', MSG_INDISP, '503 sem data paga sem banco');
    conferirErro(await chamar(base, '/payouts/agreements/7', { cookie: COOKIE }), 503, 'SERVICE_UNAVAILABLE', MSG_INDISP, '503 acordo sem banco');
    proxima = identidade('supervisora');
    conferirErro(await chamar(base, '/operations/clients?mode=hoje', { cookie: COOKIE }), 503, 'SERVICE_UNAVAILABLE', MSG_INDISP, '503 clientes sem banco');

    // 6. Sucesso: sem envelope da A, DTO puro, `no-store`, sem ETag; `?incluir=extensao` ignorado (a B não tem parâmetro).
    const original = tarologosService.listar;
    let queryVista = null;
    tarologosService.listar = async (q) => { queryVista = q; return [{ id: '7', name: 'Ana', active: true }]; };
    proxima = identidade('administradora');
    const ok = await chamar(base, '/operations/tarologists?incluir=extensao', { cookie: COOKIE });
    tarologosService.listar = original;
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual(ok.json, [{ id: '7', name: 'Ana', active: true }]);
    assert.deepStrictEqual(queryVista, {});
    assert.strictEqual(ok.headers.get('cache-control'), 'no-store');
    assert.strictEqual(ok.headers.get('etag'), null);
    console.log('  ok  200 tarólogos: DTO puro (sem {sucesso,dados}), no-store, sem ETag, sem parâmetro');

    // 7. Rotas extras: passam por método + sessão + capacidade; o resto do app não é engolido.
    proxima = identidade('administradora');
    assert.strictEqual((await chamar(base, '/operations/consultations/export', { cookie: COOKIE })).texto, 'extra');
    proxima = identidade('atendente');
    conferirErro(await chamar(base, '/operations/consultations/export', { cookie: COOKIE }), 403, 'ACCESS_DENIED', MSG_NEGADO, '403 extra sem capacidade');
    assert.strictEqual((await chamar(base, '/nao-existe')).status, 418, 'caminho fora do contrato segue para o app');
    console.log('  ok  rotas extras com sessão e capacidade; caminhos fora do contrato seguem para o app');

    // 8. Health: 503 com o mesmo envelope da B quando o legado está fora; 405 próprio.
    const h = await chamar(base, '/ops/health');
    assert.strictEqual(h.status, 503);
    assert.strictEqual(h.json.schemaVersion, 1);
    assert.strictEqual(h.json.status, 'unavailable');
    assert.strictEqual(h.json.reasonCode, 'database-unavailable');
    assert.deepStrictEqual(Object.keys(h.json), ['schemaVersion', 'status', 'reasonCode', 'releaseId', 'commitSha', 'environment', 'mode', 'checkedAt', 'checks']);
    assert.strictEqual(h.headers.get('cache-control'), 'no-store');
    const h405 = await chamar(base, '/ops/health', { metodo: 'POST', corpo: '{}', cabecalhos: { 'content-type': 'application/json' } });
    assert.strictEqual(h405.status, 405);
    assert.deepStrictEqual(h405.json, { error: 'method-not-allowed' });
    assert.strictEqual(h405.headers.get('allow'), 'GET');
    console.log('  ok  health: 503 com o envelope da B; 405 { error: "method-not-allowed" } + Allow');
  } finally {
    await fechar(srv);
  }
}

/** A "B" falsa: login devolve Set-Cookie, session confere o cookie. Conta as consultas para provar o cache de 5 s. */
async function testarProxy() {
  const visto = { sessoes: 0, logins: [], cookies: [] };
  const b = express();
  b.get('/api/auth/session', (req, res) => {
    visto.sessoes += 1;
    visto.cookies.push(req.headers.cookie);
    if (req.headers.cookie === COOKIE) return res.status(200).json({ identity: { userId: '9', displayName: 'Laya', role: 'administradora', expiresAt: 'x' }, realFeatures: {} });
    return res.status(401).json({ error: { code: 'SESSION_INVALID', message: 'Sua sessão expirou ou foi encerrada. Entre novamente.' } });
  });
  b.post('/api/auth/login', express.raw({ type: '*/*' }), (req, res) => {
    visto.logins.push({ corpo: req.body.toString(), origin: req.headers.origin });
    res.set('Set-Cookie', `__Host-gf_session=${TOKEN}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`).set('Cache-Control', 'no-store').status(200).json({ identity: { userId: '9' } });
  });
  const bSrv = await ouvir(b);
  let relogio = 1000;
  const provedor = criarProvedorProxyB({ origem: `http://127.0.0.1:${bSrv.address().port}`, agora: () => relogio });
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: provedor }));
  const srv = await ouvir(app);
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  try {
    const l = await chamar(base, '/auth/login', { metodo: 'POST', corpo: '{"login":"a","senha":"b"}', cabecalhos: { 'content-type': 'application/json', origin: 'https://gestao.exemplo' } });
    assert.strictEqual(l.status, 200);
    assert.match(l.headers.get('set-cookie'), /^__Host-gf_session=A{43}; Path=\/; HttpOnly; Secure/);
    assert.deepStrictEqual(visto.logins, [{ corpo: '{"login":"a","senha":"b"}', origin: 'https://gestao.exemplo' }]);
    console.log('  ok  proxy de login: corpo, Origin e Set-Cookie da B repassados');

    const s = await chamar(base, '/auth/session', { cookie: `${COOKIE}; outro=1` });
    assert.strictEqual(s.status, 200);
    assert.strictEqual(visto.cookies[0], COOKIE, 'só o cookie de sessão da B sai da A');
    const sOut = await chamar(base, '/auth/session', { cookie: 'gf_test_session=' + 'B'.repeat(43) });
    conferirErro(sOut, 401, 'SESSION_INVALID', 'Sua sessão expirou ou foi encerrada. Entre novamente.', 'proxy session 401 da B repassado');

    // Validação nas rotas protegidas: perfil vem da B; cache de 5 s evita a segunda ida à B.
    visto.sessoes = 0;
    conferirErro(await chamar(base, '/operations/tarologists'), 401, 'SESSION_REQUIRED', 'Entre para continuar.', 'proxy: sem cookie nem chega à B');
    conferirErro(await chamar(base, '/operations/tarologists', { cookie: '__Host-gf_session=curto' }), 401, 'SESSION_INVALID', 'Sua sessão expirou ou foi encerrada. Entre novamente.', 'proxy: token malformado nem chega à B');
    assert.strictEqual(visto.sessoes, 0);
    const original = tarologosService.listar;
    tarologosService.listar = async () => [];
    assert.strictEqual((await chamar(base, '/operations/tarologists', { cookie: COOKIE })).status, 200);
    assert.strictEqual((await chamar(base, '/operations/tarologists', { cookie: COOKIE })).status, 200);
    assert.strictEqual(visto.sessoes, 1, 'segunda chamada vem do cache');
    relogio += 6000;
    assert.strictEqual((await chamar(base, '/operations/tarologists', { cookie: COOKIE })).status, 200);
    tarologosService.listar = original;
    assert.strictEqual(visto.sessoes, 2, 'cache expira em 5 s');
    console.log('  ok  validação por GET {B}/api/auth/session, perfil extraído, cache de 5 s');

    // B fora do ar: 503 no formato B em login, session e rota protegida.
    await fechar(bSrv);
    conferirErro(await chamar(base, '/auth/login', { metodo: 'POST', corpo: '{}', cabecalhos: { 'content-type': 'application/json' } }), 503, 'SERVICE_UNAVAILABLE', MSG_INDISP, 'proxy: B fora, login 503');
    conferirErro(await chamar(base, '/auth/session', { cookie: COOKIE }), 503, 'SERVICE_UNAVAILABLE', MSG_INDISP, 'proxy: B fora, session 503');
    relogio += 6000;
    conferirErro(await chamar(base, '/operations/consultations', { cookie: COOKIE }), 503, 'SERVICE_UNAVAILABLE', MSG_INDISP, 'proxy: B fora, rota protegida 503');
  } finally {
    await fechar(srv);
    await fechar(bSrv).catch(() => undefined);
  }

  // Sem GATE_B_ORIGEM: 503 no formato B.
  const app2 = express();
  app2.use('/api', criarGate({ provedorDeSessao: criarProvedorProxyB() }));
  const srv2 = await ouvir(app2);
  const base2 = `http://127.0.0.1:${srv2.address().port}/api`;
  try {
    conferirErro(await chamar(base2, '/auth/login', { metodo: 'POST', corpo: '{}', cabecalhos: { 'content-type': 'application/json' } }), 503, 'SERVICE_UNAVAILABLE', MSG_INDISP, 'sem GATE_B_ORIGEM: login 503');
    conferirErro(await chamar(base2, '/auth/session', { cookie: COOKIE }), 503, 'SERVICE_UNAVAILABLE', MSG_INDISP, 'sem GATE_B_ORIGEM: session 503');
    conferirErro(await chamar(base2, '/operations/consultations', { cookie: COOKIE }), 503, 'SERVICE_UNAVAILABLE', MSG_INDISP, 'sem GATE_B_ORIGEM: rota protegida 503');
    conferirErro(await chamar(base2, '/auth/session', { metodo: 'DELETE' }), 405, 'METHOD_NOT_ALLOWED', 'Método não permitido.', 'session: 405');
  } finally {
    await fechar(srv2);
  }
}

(async () => {
  await testarGate();
  await testarProxy();
  await encerrarLegado();
  console.log('\nVERIFICAÇÃO OK (gate).');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
