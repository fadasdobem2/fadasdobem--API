'use strict';

/**
 * Verificação OFFLINE do provedor de sessão nativo (`src/gestao-fadas/gate/sessao-nativa.js`): serviços de auth da A
 * simulados (sem Postgres, Redis ou rede), JWT assinado com um segredo gerado aqui na hora. Sobe o gate num Express
 * efêmero (127.0.0.1) e confere o contrato da B: login por perfil, perfil sem mapeamento, senha errada, origem inválida,
 * 429, session (válido/expirado/ausente/bloqueado) e logout. Nenhum segredo real é lido ou impresso.
 *
 *   node scripts/verificar-gf-sessao-nativa.js
 */

const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.JWT_REFRESH_SECRET = crypto.randomBytes(32).toString('hex');
process.env.FADAS_ORIGIN = 'https://gestao.teste.local';
process.env.FADAS_ENVIRONMENT = 'test';
process.env.GESTAO_FADAS_ESCRITA_CONTA_ID = 'conta-servico-1';
process.env.GF_NOVOS_DADOS = 'mysql'; // conta de serviço é o modo mysql; o modo postgres (usuário da A) é conferido abaixo
delete process.env.GATE_SESSAO;

const AppError = require('../src/utils/AppError');
const { criarGate, escolherProvedor } = require('../src/gestao-fadas/gate');
const { criarProvedorNativo } = require('../src/gestao-fadas/gate/sessao-nativa');
const { criarProvedorProxyB } = require('../src/gestao-fadas/gate/sessao-proxy-b');
const { limitarComLimitadores } = require('../src/gestao-fadas/gate/sessao-nativa-http');
const { aplicarContexto } = require('../src/gestao-fadas/gate/contexto');

const ORIGEM = process.env.FADAS_ORIGIN;
const OPCOES = { issuer: 'fadasdobem-api', audience: 'fadasdobem-clients' };
const SENHA = 'senha-de-teste';

// Usuários simulados: id -> { role (produto), roleIds (RBAC), ativo }
const USUARIOS = {
  adm: { id: 'u-adm', email: 'adm@teste.local', role: 'GESTORA', roleIds: ['admin'] },
  ass: { id: 'u-ass', email: 'ass@teste.local', role: 'ATENDENTE', roleIds: ['financeiro'] },
  sup: { id: 'u-sup', email: 'sup@teste.local', role: 'ATENDENTE', roleIds: ['supervisora'] },
  ate: { id: 'u-ate', email: 'ate@teste.local', role: 'ATENDENTE', roleIds: [] },
  tar: { id: 'u-tar', email: 'tar@teste.local', role: 'TAROLOGA', roleIds: [] },
  mkt: { id: 'u-mkt', email: 'mkt@teste.local', role: 'CLIENTE', roleIds: ['marketing'] },
  cli: { id: 'u-cli', email: 'cli@teste.local', role: 'CLIENTE', roleIds: [] },
  blq: { id: 'u-blq', email: 'blq@teste.local', role: 'GESTORA', roleIds: ['admin'], blocked_at: new Date() },
};
const porId = (id) => Object.values(USUARIOS).find((u) => u.id === id);
const porEmail = (e) => Object.values(USUARIOS).find((u) => u.email === e);

const revogados = []; // jti revogados
const revogadosTodos = []; // usuários com todos os refresh revogados
const tentativas = new Map();
let limiteDeTentativas = 1000;

function emitir(u, { account_type = 'user', expiraEm = '30m' } = {}) {
  const access = jwt.sign({ sub: u.id, token_use: 'access', account_type }, process.env.JWT_SECRET, { ...OPCOES, expiresIn: expiraEm });
  const jti = crypto.randomUUID();
  const refresh = jwt.sign({ sub: u.id, token_use: 'refresh', jti }, process.env.JWT_REFRESH_SECRET, { ...OPCOES, expiresIn: '12h' });
  return { access_token: access, refresh_token: refresh, access_expires_in: 1800, refresh_expires_in: 43200 };
}

const servicos = {
  async login({ email, password }) {
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new AppError('Formato inválido.', 400, null, true);
    const u = porEmail(email);
    if (u && (u.blocked_at)) throw new AppError('Conta indisponível.', 403, null, true);
    if (!u || password !== SENHA) throw new AppError('Email ou senha incorretos.', 401, null, true);
    return { ...emitir(u), usuario: { id: u.id } };
  },
  async buscarUsuario(id) { const u = porId(id); return u ? { ...u, is_active: true } : null; },
  async carregarContexto(id) { const u = porId(id); return { roleIds: u ? u.roleIds : [], staffProfile: u && u.id === 'u-adm' ? { display_name: 'Laya' } : null }; },
  async revogarPorJti(jti) { revogados.push(jti); },
  async revogarTodos(id) { revogadosTodos.push(id); },
  async limitar(_req, identifier) {
    const n = (tentativas.get(identifier) || 0) + 1;
    tentativas.set(identifier, n);
    return n > limiteDeTentativas ? { limitado: true, retryAfter: 900 } : { limitado: false };
  },
};

const ouvir = (app) => new Promise((resolve) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s)); });
const fechar = (s) => new Promise((r) => s.close(r));

function chamar(porta, metodo, caminho, { corpo, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const dados = corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: { ...(dados !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let t = '';
      res.on('data', (c) => { t += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, texto: t, json: t ? JSON.parse(t) : null }));
    });
    req.on('error', reject);
    if (dados !== undefined) req.write(dados);
    req.end();
  });
}
const escrita = (extra = {}) => ({ origin: ORIGEM, ...extra });
const cookiesDe = (r) => (r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
const ERR = (r, status, code) => { assert.strictEqual(r.status, status, `status ${r.status} != ${status} (${r.texto})`); assert.strictEqual(r.json.error.code, code); assert.strictEqual(r.headers['cache-control'], 'no-store'); };

(async () => {
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: criarProvedorNativo({ servicos }) }));
  const srv = await ouvir(app);
  const p = srv.address().port;
  const login = (identifier, password = SENHA, headers = escrita()) => chamar(p, 'POST', '/api/auth/login', { corpo: { identifier, password }, headers });

  // Login por perfil: formato da B, role mapeado, cookies da A, sem token no corpo
  const perfis = { adm: 'administradora', ass: 'assistente', sup: 'supervisora', ate: 'atendente', tar: 'tarologa' };
  perfis.ate = 'atendente'; // sem papel RBAC: vale o papel de produto
  for (const [k, perfil] of Object.entries(perfis)) {
    const r = await login(USUARIOS[k].email);
    assert.strictEqual(r.status, 200, `${k}: ${r.texto}`);
    assert.deepStrictEqual(Object.keys(r.json), ['identity']);
    assert.deepStrictEqual(Object.keys(r.json.identity), ['userId', 'displayName', 'role', 'expiresAt']);
    assert.strictEqual(r.json.identity.role, perfil);
    assert.strictEqual(r.json.identity.userId, USUARIOS[k].id);
    assert.ok(!Number.isNaN(Date.parse(r.json.identity.expiresAt)));
    assert.ok(!/access_token|refresh_token|eyJ/.test(r.texto), 'token no corpo');
    const sc = r.headers['set-cookie'].join('\n');
    assert.ok(/fdb_access=/.test(sc) && /fdb_refresh=/.test(sc) && /HttpOnly/.test(sc), 'cookies da A');
    assert.ok(/Path=\/api(;|$)/m.test(sc) && /Path=\/api\/v1\/auth/.test(sc));
    assert.strictEqual(r.headers['cache-control'], 'no-store');
  }
  assert.strictEqual((await login('adm@teste.local')).json.identity.displayName, 'Laya');
  assert.strictEqual((await login('ass@teste.local')).json.identity.displayName, 'ass@teste.local');

  // Perfil sem mapeamento (marketing, cliente): 403 e refresh revogado, sem cookie
  for (const k of ['mkt', 'cli']) {
    const antes = revogados.length;
    const r = await login(USUARIOS[k].email);
    ERR(r, 403, 'ACCOUNT_ACCESS_UNAVAILABLE');
    assert.strictEqual(r.json.error.message, 'Sua conta ainda não pode acessar o sistema. Procure a administração.');
    assert.strictEqual(revogados.length, antes + 1);
    assert.ok(!r.headers['set-cookie']);
  }

  // Credenciais: senha errada, usuário inexistente, não-email e conta bloqueada: a MESMA resposta
  const msg = 'Usuário ou senha incorretos.';
  const rs = await login('adm@teste.local', 'errada');
  ERR(rs, 401, 'INVALID_CREDENTIALS');
  assert.strictEqual(rs.json.error.message, msg);
  for (const id of ['naoexiste@teste.local', 'joao', 'blq@teste.local']) {
    const r = await login(id, 'errada');
    ERR(r, 401, 'INVALID_CREDENTIALS');
    assert.strictEqual(r.texto, rs.texto);
  }
  ERR(await login('blq@teste.local', SENHA), 401, 'INVALID_CREDENTIALS'); // nem a senha certa revela o bloqueio
  assert.ok(!rs.headers['set-cookie']);

  // Origem, mídia, corpo
  ERR(await login('adm@teste.local', SENHA, {}), 403, 'ORIGIN_NOT_ALLOWED');
  ERR(await login('adm@teste.local', SENHA, { origin: 'https://evil.exemplo' }), 403, 'ORIGIN_NOT_ALLOWED');
  ERR(await chamar(p, 'POST', '/api/auth/login', { corpo: 'identifier=a', headers: escrita({ 'content-type': 'text/plain' }) }), 415, 'UNSUPPORTED_MEDIA_TYPE');
  ERR(await chamar(p, 'POST', '/api/auth/login', { corpo: '{ruim', headers: escrita() }), 400, 'INVALID_INPUT');
  ERR(await chamar(p, 'POST', '/api/auth/login', { corpo: { identifier: 'a@b.c' }, headers: escrita() }), 400, 'INVALID_INPUT');
  ERR(await chamar(p, 'POST', '/api/auth/login', { corpo: { identifier: 'a@b.c', password: 'x', role: 'administradora' }, headers: escrita() }), 400, 'INVALID_INPUT');
  ERR(await chamar(p, 'POST', '/api/auth/login', { corpo: { identifier: 123, password: 'x' }, headers: escrita() }), 400, 'INVALID_INPUT');
  ERR(await chamar(p, 'POST', '/api/auth/login', { corpo: { identifier: 'a@b.c', password: 'x'.repeat(20000) }, headers: escrita() }), 413, 'PAYLOAD_TOO_LARGE');
  ERR(await chamar(p, 'GET', '/api/auth/login'), 405, 'METHOD_NOT_ALLOWED');

  // 429
  tentativas.clear();
  limiteDeTentativas = 2;
  await login('rl@teste.local'); await login('rl@teste.local');
  const r429 = await login('rl@teste.local');
  ERR(r429, 429, 'TRY_LATER');
  assert.strictEqual(r429.headers['retry-after'], '900');
  assert.strictEqual(r429.json.error.message, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
  limiteDeTentativas = 1000;

  // Session: cookie válido, ausente, expirado, malformado, bloqueado, sem perfil
  const entrou = await login('adm@teste.local');
  const ck = cookiesDe(entrou);
  const ses = await chamar(p, 'GET', '/api/auth/session', { headers: { cookie: ck } });
  assert.strictEqual(ses.status, 200);
  assert.deepStrictEqual(Object.keys(ses.json), ['identity', 'realFeatures']);
  assert.deepStrictEqual(ses.json.realFeatures, { payouts: true });
  assert.strictEqual(ses.json.identity.role, 'administradora');
  assert.deepStrictEqual(Object.keys(ses.json.identity), ['userId', 'displayName', 'role', 'expiresAt']); // sem gfContaId
  ERR(await chamar(p, 'GET', '/api/auth/session'), 401, 'SESSION_REQUIRED');
  const expirado = jwt.sign({ sub: 'u-adm', token_use: 'access', account_type: 'user' }, process.env.JWT_SECRET, { ...OPCOES, expiresIn: -10 });
  ERR(await chamar(p, 'GET', '/api/auth/session', { headers: { cookie: `fdb_access=${expirado}` } }), 401, 'SESSION_INVALID');
  ERR(await chamar(p, 'GET', '/api/auth/session', { headers: { cookie: 'fdb_access=lixo' } }), 401, 'SESSION_INVALID');
  const outroSegredo = jwt.sign({ sub: 'u-adm', token_use: 'access' }, 'x'.repeat(40), { ...OPCOES, expiresIn: '5m' });
  ERR(await chamar(p, 'GET', '/api/auth/session', { headers: { cookie: `fdb_access=${outroSegredo}` } }), 401, 'SESSION_INVALID');
  const comoRefresh = emitir(USUARIOS.adm).refresh_token;
  ERR(await chamar(p, 'GET', '/api/auth/session', { headers: { cookie: `fdb_access=${comoRefresh}` } }), 401, 'SESSION_INVALID');
  ERR(await chamar(p, 'GET', '/api/auth/session', { headers: { cookie: `fdb_access=${emitir(USUARIOS.blq).access_token}` } }), 403, 'ACCOUNT_ACCESS_UNAVAILABLE');
  ERR(await chamar(p, 'GET', '/api/auth/session', { headers: { cookie: `fdb_access=${emitir(USUARIOS.mkt).access_token}` } }), 403, 'ACCOUNT_ACCESS_UNAVAILABLE');
  ERR(await chamar(p, 'GET', '/api/auth/session', { headers: { cookie: `fdb_access=${emitir(USUARIOS.adm, { account_type: 'temp' }).access_token}` } }), 403, 'ACCOUNT_ACCESS_UNAVAILABLE');
  ERR(await chamar(p, 'GET', '/api/auth/session', { headers: { cookie: `fdb_access=${emitir({ id: 'fantasma' }).access_token}` } }), 401, 'SESSION_INVALID');
  ERR(await chamar(p, 'POST', '/api/auth/session'), 405, 'METHOD_NOT_ALLOWED');
  process.env.FADAS_ENVIRONMENT = 'production';
  assert.deepStrictEqual((await chamar(p, 'GET', '/api/auth/session', { headers: { cookie: ck } })).json.realFeatures, { payouts: false });
  process.env.FADAS_ENVIRONMENT = 'test';

  // validar(): identidade, sessionId estável e que não contém o token, conta de serviço
  const prov = criarProvedorNativo({ servicos });
  const reqDe = (cookie) => ({ headers: { cookie } });
  const v1 = await prov.validar(reqDe(ck));
  const v2 = await prov.validar(reqDe(ck));
  assert.strictEqual(v1.status, 'identity');
  assert.strictEqual(v1.sessionId, v2.sessionId);
  assert.ok(/^[0-9a-f]{32}$/.test(v1.sessionId));
  assert.strictEqual(v1.identity.gfContaId, 'conta-servico-1');
  // Banco novo (padrão): a conta que assina é o usuário da A, sem conta de serviço.
  assert.strictEqual((await criarProvedorNativo({ servicos, env: { GF_NOVOS_DADOS: 'postgres' } }).validar(reqDe(ck))).identity.gfContaId, v1.identity.userId);
  // Access JWT sem estado: com o refresh revogado (depois do logout) o cookie copiado deixa de valer.
  assert.strictEqual((await criarProvedorNativo({ servicos: { ...servicos, temSessaoViva: async () => false } }).validar(reqDe(ck))).status, 'invalid');
  assert.strictEqual((await criarProvedorNativo({ servicos: { ...servicos, temSessaoViva: async () => true } }).validar(reqDe(ck))).status, 'identity');
  assert.strictEqual((await prov.validar({ headers: {} })).status, 'absent');
  assert.strictEqual((await prov.validar(reqDe('fdb_access=lixo'))).status, 'invalid');
  assert.strictEqual((await criarProvedorNativo({ servicos: { ...servicos, buscarUsuario: async () => { throw new Error('banco fora'); } } }).validar(reqDe(ck))).status, 'unavailable');
  assert.strictEqual((await criarProvedorNativo({ servicos, env: { GF_NOVOS_DADOS: 'mysql' } }).validar(reqDe(ck))).identity.gfContaId, null); // sem conta de serviço: nulo
  // o contexto do gate aceita a identidade nativa (ida e volta do perfil)
  const rq = {}; aplicarContexto(rq, v1);
  assert.strictEqual(rq.perfilGate, 'administradora');

  // Logout: 204, cookies expirados, refresh revogado; sem Origin 403; corpo diferente de {} 400; sem cookie nada a revogar
  const refreshCookie = cookiesDe(entrou).split('; ').find((c) => c.startsWith('fdb_refresh='));
  const jtiEsperado = jwt.decode(refreshCookie.split('=')[1]).jti;
  const out = await chamar(p, 'POST', '/api/auth/logout', { corpo: {}, headers: escrita({ cookie: ck }) });
  assert.strictEqual(out.status, 204);
  assert.strictEqual(out.texto, '');
  assert.ok(out.headers['set-cookie'].length === 2 && out.headers['set-cookie'].every((c) => /Expires=Thu, 01 Jan 1970/.test(c)));
  assert.ok(revogados.includes(jtiEsperado), 'revoga pelo jti do refresh recebido');
  const todos0 = revogadosTodos.length;
  const out2 = await chamar(p, 'POST', '/api/auth/logout', { corpo: {}, headers: escrita({ cookie: ck.split('; ')[0] }) });
  assert.strictEqual(out2.status, 204);
  assert.deepStrictEqual(revogadosTodos.slice(todos0), ['u-adm']); // sem refresh no request: todos do usuário
  const out3 = await chamar(p, 'POST', '/api/auth/logout', { corpo: {}, headers: escrita() });
  assert.strictEqual(out3.status, 204);
  assert.strictEqual(revogadosTodos.length, todos0 + 1);
  ERR(await chamar(p, 'POST', '/api/auth/logout', { corpo: {}, headers: { cookie: ck } }), 403, 'ORIGIN_NOT_ALLOWED');
  ERR(await chamar(p, 'POST', '/api/auth/logout', { corpo: { a: 1 }, headers: escrita({ cookie: ck }) }), 400, 'INVALID_INPUT');
  const falha = criarProvedorNativo({ servicos: { ...servicos, revogarTodos: async () => { throw new Error('x'); } } });
  const f = await falha.logout({ headers: { origin: ORIGEM, 'content-type': 'application/json', cookie: ck.split('; ')[0] }, body: {} });
  assert.strictEqual(f.status, 503);
  assert.ok(!f.headers['Set-Cookie']);

  // FADAS_ORIGIN ausente: configuração quebrada = 503, nunca "aceita tudo"
  delete process.env.FADAS_ORIGIN;
  ERR(await login('adm@teste.local'), 503, 'SERVICE_UNAVAILABLE');
  process.env.FADAS_ORIGIN = ORIGEM;

  // Seleção por env
  assert.strictEqual(typeof escolherProvedor({}).login, 'function');
  assert.notStrictEqual(escolherProvedor({ GATE_SESSAO: 'nativa' }).validar.toString(), criarProvedorProxyB().validar.toString());

  // Limitadores reais da A (MemoryStore, sem Redis) por trás do adaptador: 5 por IP em 15 min, depois 429
  process.env.AUTH_RATE_LIMIT_DISABLED = 'false'; // o .env local pode desligar o limite; aqui ele precisa valer
  const express2 = express();
  const rl = require('../src/middlewares/rateLimit.middleware');
  const lim = limitarComLimitadores([rl.loginRegisterIpLimiter, rl.loginEmailLimiter]);
  express2.post('/x', async (req, res) => { const r = await lim(req, 'rl-real@teste.local'); res.status(r.limitado ? 429 : 200).json(r); });
  const s2 = await ouvir(express2);
  const codigos = [];
  for (let i = 0; i < 7; i++) codigos.push((await chamar(s2.address().port, 'POST', '/x', { corpo: {} })).status);
  assert.deepStrictEqual(codigos, [200, 200, 200, 200, 200, 429, 429]);
  await fechar(s2);

  await fechar(srv);
  console.log('verificar-gf-sessao-nativa: OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
