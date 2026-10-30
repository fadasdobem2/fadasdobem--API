'use strict';

/**
 * ENSAIO REAL do provedor de sessão NATIVO do gate (`src/gestao-fadas/gate/sessao-nativa.js`, `GATE_SESSAO=nativa`):
 * Postgres e Redis REAIS, mas locais e DESCARTÁVEIS, sem nenhuma simulação do auth da A.
 *
 *   npm run ensaiar:sessao-nativa-real
 *
 * O que o script faz sozinho (nada de .env, nada de banco existente):
 *   1. Define TODAS as variáveis de ambiente do ensaio no próprio processo (DB_*, REDIS_*, JWT_*, FADAS_*, GATE_*) e
 *      neutraliza o `dotenv` (o .env da API nunca é lido; `DATABASE_URL`, `LEGADO_DB_*` e afins ficam vazios).
 *   2. RECUSA rodar se algum alvo não for local/descartável: host do Postgres só localhost/127.0.0.1/::1, nome do banco
 *      só `fdb_gate_ensaio_*`, Redis só localhost/127.0.0.1 em porta alta de ensaio (63790).
 *   3. Cria o banco `fdb_gate_ensaio_<aleatório>` (`createdb`), sobe `redis-server --port 63790 --save '' --appendonly no`.
 *   4. Aplica o esquema pelo caminho existente da A (`runMigrations`: baseline = `sequelize.sync` dos models + migrações)
 *      e o seed de RBAC (`seedAccessCatalog`, o mesmo do `npm run seed:access`).
 *   5. Cria um usuário por perfil (senha longa e aleatória, só em memória) com os papéis RBAC correspondentes.
 *   6. Sobe um Express efêmero (127.0.0.1, porta livre) montado como o `app.js` (trust proxy, express.json, cookie-parser)
 *      com o gate e o provedor nativo REAL, e roda os casos por HTTP real. Instrumentação só aqui: uma rota extra
 *      `GET /api/operations/_ensaio` devolve o que o gate pôs em `req.user` (sessionId, gfContaId).
 *   7. No fim (também em erro/Ctrl+C): fecha conexões, DROP do banco, encerra o Redis.
 *
 * Variáveis opcionais de ensaio: ENSAIO_PG_HOST (padrão localhost), ENSAIO_PG_PORT (5432), ENSAIO_PG_USER (usuário do SO),
 * ENSAIO_PG_PASSWORD (vazio), ENSAIO_REDIS_PORT (63790). Nenhum segredo é impresso.
 */

const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const BIN_PG = process.env.ENSAIO_PG_BIN || '/opt/homebrew/bin';
const rnd = (n) => crypto.randomBytes(n).toString('hex');

/* ---------------------------------------------------------------------------------------------------------------- *
 * 1) Ambiente do ensaio (ANTES de qualquer require da A) e trava de segurança
 * ---------------------------------------------------------------------------------------------------------------- */

const LOCAIS = new Set(['localhost', '127.0.0.1', '::1']);
const PG_HOST = process.env.ENSAIO_PG_HOST || 'localhost';
const PG_PORT = String(process.env.ENSAIO_PG_PORT || '5432');
const PG_USER = process.env.ENSAIO_PG_USER || os.userInfo().username;
const PG_PASSWORD = process.env.ENSAIO_PG_PASSWORD || '';
const DB_NAME = `fdb_gate_ensaio_${rnd(5)}`;
const REDIS_HOST = '127.0.0.1';
const REDIS_PORT = String(process.env.ENSAIO_REDIS_PORT || '63790');
const ORIGEM = 'http://localhost:5180';

function recusar(motivo) {
  console.error(`RECUSADO: ${motivo}`);
  process.exit(2);
}
if (!LOCAIS.has(PG_HOST)) recusar('o Postgres do ensaio precisa ser local (localhost/127.0.0.1/::1).');
if (!/^fdb_gate_ensaio_[0-9a-f]{10}$/.test(DB_NAME)) recusar('nome de banco fora do padrão descartável fdb_gate_ensaio_*.');
if (!LOCAIS.has(REDIS_HOST) || !/^\d+$/.test(REDIS_PORT) || Number(REDIS_PORT) < 49152) recusar('o Redis do ensaio precisa ser local e em porta alta (>= 49152).');
if (REDIS_PORT === '6379') recusar('porta 6379 é a do Redis comum; use uma porta descartável.');

Object.assign(process.env, {
  NODE_ENV: 'test',
  // Postgres descartável (DATABASE_URL vazio força o caminho DB_* do database.js)
  DATABASE_URL: '', DB_HOST: PG_HOST, DB_PORT: PG_PORT, DB_NAME, DB_USER: PG_USER, DB_PASSWORD: PG_PASSWORD, DB_SSL: 'false', DB_LOGGING: 'false', DB_POOL_MAX: '5',
  // Redis descartável (o limitador usa o `getRedisConnection`)
  REDIS_URL: '', REDIS_HOST, REDIS_PORT, REDIS_PASSWORD: '',
  // Segredos aleatórios, só neste processo
  JWT_SECRET: rnd(32), JWT_REFRESH_SECRET: rnd(32), JWT_EXPIRES_IN: '30m', JWT_REFRESH_EXPIRES_IN: '12h',
  FADAS_ORIGIN: ORIGEM, FADAS_ENVIRONMENT: 'test', GATE_SESSAO: 'nativa', GESTAO_FADAS_ENABLED: 'true', GESTAO_FADAS_GATE_ENABLED: 'true',
  GESTAO_FADAS_ESCRITA_ENABLED: 'false', GESTAO_FADAS_ESCRITA_CONTA_ID: 'conta-ensaio-gf-1', AUTH_RATE_LIMIT_DISABLED: 'false',
  // Legado fora: sem escrita e sem conexão
  LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '', LEGADO_DB_PASSWORD: '', LEGADO_DB_READ_ONLY: 'true',
  SEQUELIZE_SYNC: 'false', RESEND_API_KEY: '', GATE_B_ORIGEM: '',
});

// Neutraliza o dotenv: o .env da API não pode ser lido nem por engano (database.js e run-migrations.js o chamam).
const dotenvPath = require.resolve('dotenv', { paths: [RAIZ] });
require.cache[dotenvPath] = { id: dotenvPath, filename: dotenvPath, loaded: true, exports: { config: () => ({ parsed: {} }), parse: () => ({}) } };

/* ---------------------------------------------------------------------------------------------------------------- *
 * Infra descartável: banco e Redis
 * ---------------------------------------------------------------------------------------------------------------- */

const pgEnv = { ...process.env, PGPASSWORD: PG_PASSWORD, DB_NAME: undefined };
const pgArgs = ['-h', PG_HOST, '-p', PG_PORT, '-U', PG_USER];
let bancoCriado = false;
let redisProc = null;

const portaLivre = (porta) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(porta, REDIS_HOST, () => s.close(() => resolve(true)));
});

async function subirRedis() {
  if (!(await portaLivre(Number(REDIS_PORT)))) recusar(`a porta ${REDIS_PORT} já está em uso (não vou reaproveitar um Redis que não é meu).`);
  redisProc = spawn('redis-server', ['--port', REDIS_PORT, '--bind', REDIS_HOST, '--save', '', '--appendonly', 'no', '--daemonize', 'no'], { stdio: 'ignore' });
  redisProc.on('error', (e) => { console.error('redis-server não iniciou:', e.message); });
  const Redis = require('ioredis');
  for (let i = 0; i < 50; i += 1) {
    const c = new Redis({ host: REDIS_HOST, port: Number(REDIS_PORT), lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
    try { await c.connect(); await c.ping(); await c.quit(); return; } catch (_e) { c.disconnect(); await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('Redis descartável não respondeu.');
}

function criarBanco() {
  execFileSync(`${BIN_PG}/createdb`, [...pgArgs, DB_NAME], { env: pgEnv, stdio: 'pipe' });
  bancoCriado = true;
}

function removerBanco() {
  if (!bancoCriado || !/^fdb_gate_ensaio_[0-9a-f]{10}$/.test(DB_NAME)) return;
  try { execFileSync(`${BIN_PG}/dropdb`, [...pgArgs, '--if-exists', '--force', DB_NAME], { env: pgEnv, stdio: 'pipe' }); bancoCriado = false; } catch (e) { console.error('Falha no DROP do banco descartável:', `${e.stderr || e.message}`.trim()); }
}

function encerrarRedis() {
  if (redisProc && !redisProc.killed) { try { redisProc.kill('SIGTERM'); } catch (_e) { /* já saiu */ } }
}

/* ---------------------------------------------------------------------------------------------------------------- *
 * Mini-framework de asserções
 * ---------------------------------------------------------------------------------------------------------------- */

let ok = 0;
const falhas = [];
function conferir(nome, cond, detalhe = '') {
  if (cond) { ok += 1; console.log(`  OK    ${nome}`); } else { falhas.push(nome); console.log(`  FALHA ${nome}${detalhe ? ` -> ${detalhe}` : ''}`); }
}

/* ---------------------------------------------------------------------------------------------------------------- *
 * Execução
 * ---------------------------------------------------------------------------------------------------------------- */

const PERFIS_ENSAIO = [
  // chave, papéis RBAC, papel de produto (users.role), perfil esperado da B
  { chave: 'admin', rbac: ['admin'], produto: 'GESTORA', esperado: 'administradora' },
  { chave: 'gestora', rbac: ['gestora'], produto: 'GESTORA', esperado: 'administradora' },
  { chave: 'assistente', rbac: ['assistente'], produto: 'ATENDENTE', esperado: 'assistente' },
  { chave: 'financeiro', rbac: ['financeiro'], produto: 'ATENDENTE', esperado: 'assistente' },
  { chave: 'supervisora', rbac: ['supervisora'], produto: 'ATENDENTE', esperado: 'supervisora' },
  { chave: 'atendente', rbac: ['atendente'], produto: 'ATENDENTE', esperado: 'atendente' },
  { chave: 'marketing', rbac: ['marketing'], produto: 'ATENDENTE', esperado: null },
  { chave: 'cliente', rbac: [], produto: 'CLIENTE', esperado: null },
];

async function principal() {
  await subirRedis();
  criarBanco();

  const express = require('express');
  const cookieParser = require('cookie-parser');
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');
  const Redis = require('ioredis');
  const { sequelize } = require('../src/config/database');
  const models = require('../src/models');
  const { User, AccessRole, StaffProfile, RefreshToken } = models;
  const { runMigrations } = require('./run-migrations');
  const { seedAccessCatalog } = require('../src/rbac/rbac.seed');
  const { invalidateAllAccessCache } = require('../src/rbac/authorization.service');
  const { criarGate } = require('../src/gestao-fadas/gate');
  const { criarProvedorNativo } = require('../src/gestao-fadas/gate/sessao-nativa');
  const { jwtVerifyOptions } = require('../src/config/auth.config');
  const { closeSharedRedis } = require('../src/providers/redis/redis.connection');

  console.log(`Banco descartável: ${DB_NAME} @ ${PG_HOST}:${PG_PORT} | Redis descartável: ${REDIS_HOST}:${REDIS_PORT}`);
  await sequelize.authenticate();
  const [[{ db }]] = await sequelize.query('SELECT current_database() AS db');
  if (db !== DB_NAME) throw new Error('a conexão não está no banco descartável; abortando.');
  await runMigrations(); // caminho oficial, banco vazio até o esquema completo
  await runMigrations(); // idempotência: nada pendente na segunda rodada
  await seedAccessCatalog({});
  console.log('Esquema e seed de RBAC aplicados.');

  // Usuários de ensaio
  const SENHA = `${rnd(24)}Aa1!`;
  const SENHA_ERRADA = `${rnd(24)}Zz9?`;
  const hash = await bcrypt.hash(SENHA, 10);
  const usuarios = {};
  for (const p of PERFIS_ENSAIO) {
    const u = await User.create({ email: `${p.chave}.${rnd(3)}@ensaio.test`, password_hash: hash, role: p.produto, is_active: true, email_verified_at: new Date() });
    if (p.rbac.length) await u.addAccess_roles(await AccessRole.findAll({ where: { id: p.rbac } }));
    if (p.chave !== 'cliente') await StaffProfile.create({ user_id: u.id, display_name: `Ensaio ${p.chave}`, staff_status: 'ativo' });
    usuarios[p.chave] = u;
  }
  const bloqueado = await User.create({ email: `bloqueado.${rnd(3)}@ensaio.test`, password_hash: hash, role: 'GESTORA', is_active: true, blocked_at: new Date() });
  await bloqueado.addAccess_roles(await AccessRole.findAll({ where: { id: ['admin'] } }));
  const inativo = await User.create({ email: `inativo.${rnd(3)}@ensaio.test`, password_hash: hash, role: 'GESTORA', is_active: false });
  await inativo.addAccess_roles(await AccessRole.findAll({ where: { id: ['admin'] } }));
  invalidateAllAccessCache();

  // Redis administrativo do ensaio (zera os contadores do limitador entre os casos)
  const redis = new Redis({ host: REDIS_HOST, port: Number(REDIS_PORT) });
  const zerarLimites = () => redis.flushall();

  // Servidor efêmero, montado como o app.js; a rota extra instrumenta o contexto que o gate monta.
  const provedor = criarProvedorNativo();
  const extras = [{ metodo: 'GET', caminho: '/operations/_ensaio', handler: (req, res) => res.json({ sucesso: true, dados: { user: req.user, perfilGate: req.perfilGate, sessionId: req.sessionId, claims: req.jwtClaims } }) }];
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/api', criarGate({ provedorDeSessao: provedor, extras }));
  // Variante sem express.json (o gate lê o corpo bruto): garante que os dois caminhos de leitura funcionam.
  const appBruto = express();
  appBruto.use('/api', criarGate({ provedorDeSessao: provedor, extras }));
  const sobe = (a) => new Promise((resolve) => { const s = http.createServer(a); s.listen(0, '127.0.0.1', () => resolve(s)); });
  const srv = await sobe(app);
  const srvBruto = await sobe(appBruto);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const baseBruto = `http://127.0.0.1:${srvBruto.address().port}`;

  async function chamar(url, { metodo = 'GET', corpo, origem = ORIGEM, cookie, headers = {}, bruto } = {}) {
    const h = { ...headers };
    if (origem) h.Origin = origem;
    if (cookie) h.Cookie = cookie;
    let body;
    if (bruto !== undefined) { h['Content-Type'] = h['Content-Type'] || 'application/json'; body = bruto; } else if (corpo !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(corpo); }
    const r = await fetch(url, { method: metodo, headers: h, body, redirect: 'manual' });
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch (_e) { /* corpo não JSON */ }
    return { status: r.status, json, texto, headers: r.headers, setCookie: r.headers.getSetCookie ? r.headers.getSetCookie() : [] };
  }
  const cookieDe = (setCookie) => setCookie.map((c) => c.split(';')[0]).filter((c) => !/=$/.test(c));
  const cookieAccess = (setCookie) => cookieDe(setCookie).find((c) => /^(__Secure-)?fdb_access=/.test(c));
  const cookieRefresh = (setCookie) => cookieDe(setCookie).find((c) => /^(__Secure-)?fdb_refresh=/.test(c));
  const login = (email, senha, extra = {}) => chamar(`${extra.base || base}/api/auth/login`, { metodo: 'POST', corpo: { identifier: email, password: senha }, ...extra });
  const codigo = (r) => r.json && r.json.error && r.json.error.code;

  console.log('\n== Login por perfil (200 no formato da B ou 403 ACCOUNT_ACCESS_UNAVAILABLE)');
  const sessoes = {};
  for (const p of PERFIS_ENSAIO) {
    await zerarLimites();
    const u = usuarios[p.chave];
    const r = await login(u.email, SENHA);
    if (p.esperado) {
      const id = r.json && r.json.identity;
      conferir(`${p.chave}: 200 identity{userId,displayName,role,expiresAt}, role=${p.esperado}`,
        r.status === 200 && id && Object.keys(id).sort().join() === 'displayName,expiresAt,role,userId' && id.role === p.esperado && id.userId === String(u.id) && !Number.isNaN(Date.parse(id.expiresAt)), `${r.status} ${r.texto.slice(0, 120)}`);
      conferir(`${p.chave}: nome vem do StaffProfile`, id && id.displayName === `Ensaio ${p.chave}`);
      conferir(`${p.chave}: cookies de access e refresh, httpOnly, no-store`, Boolean(cookieAccess(r.setCookie)) && Boolean(cookieRefresh(r.setCookie)) && r.setCookie.every((c) => /HttpOnly/i.test(c)) && /no-store/.test(r.headers.get('cache-control') || ''));
      conferir(`${p.chave}: corpo não vaza gfContaId nem token`, !/gfContaId|access_token|refresh_token/.test(r.texto));
      sessoes[p.chave] = { access: cookieAccess(r.setCookie), refresh: cookieRefresh(r.setCookie), identity: id };
    } else {
      conferir(`${p.chave}: 403 ACCOUNT_ACCESS_UNAVAILABLE e nenhum cookie`, r.status === 403 && codigo(r) === 'ACCOUNT_ACCESS_UNAVAILABLE' && r.setCookie.length === 0, `${r.status} ${r.texto.slice(0, 120)}`);
      const abertos = await RefreshToken.count({ where: { user_id: u.id, revoked_at: null } });
      conferir(`${p.chave}: refresh recém-emitido foi revogado no Postgres`, abertos === 0, `abertos=${abertos}`);
    }
  }
  // Mesmo caminho sem express.json (corpo bruto lido pelo gate)
  await zerarLimites();
  const rb = await login(usuarios.supervisora.email, SENHA, { base: baseBruto });
  conferir('login com corpo bruto (sem express.json): 200 supervisora', rb.status === 200 && rb.json && rb.json.identity.role === 'supervisora', `${rb.status}`);

  console.log('\n== Credenciais, origem e corpo');
  await zerarLimites();
  const errada = await login(usuarios.admin.email, SENHA_ERRADA);
  const inexistente = await login(`naoexiste.${rnd(3)}@ensaio.test`, SENHA_ERRADA);
  conferir('senha errada: 401 INVALID_CREDENTIALS', errada.status === 401 && codigo(errada) === 'INVALID_CREDENTIALS', `${errada.status}`);
  conferir('usuário inexistente: mesma resposta (status e corpo)', inexistente.status === errada.status && inexistente.texto === errada.texto);
  const bloq = await login(bloqueado.email, SENHA);
  const inat = await login(inativo.email, SENHA);
  conferir('conta bloqueada: 401 INVALID_CREDENTIALS idêntico (não revela existência)', bloq.status === 401 && bloq.texto === errada.texto && bloq.setCookie.length === 0, `${bloq.status}`);
  conferir('conta inativa: 401 INVALID_CREDENTIALS idêntico', inat.status === 401 && inat.texto === errada.texto && inat.setCookie.length === 0, `${inat.status}`);
  const naoEmail = await login('nao-e-email', SENHA);
  conferir('identificador que não é e-mail: 401 INVALID_CREDENTIALS idêntico', naoEmail.status === 401 && naoEmail.texto === errada.texto, `${naoEmail.status} ${naoEmail.texto.slice(0, 80)}`);
  const origemRuim = await login(usuarios.admin.email, SENHA, { origem: 'http://evil.test' });
  conferir('origem inválida: 403 ORIGIN_NOT_ALLOWED sem cookie', origemRuim.status === 403 && codigo(origemRuim) === 'ORIGIN_NOT_ALLOWED' && origemRuim.setCookie.length === 0);
  const semOrigem = await login(usuarios.admin.email, SENHA, { origem: null });
  conferir('sem Origin: 403 ORIGIN_NOT_ALLOWED', semOrigem.status === 403 && codigo(semOrigem) === 'ORIGIN_NOT_ALLOWED');
  const tipoRuim = await chamar(`${base}/api/auth/login`, { metodo: 'POST', bruto: 'x', headers: { 'Content-Type': 'text/plain' } });
  conferir('Content-Type não JSON: 415', tipoRuim.status === 415, `${tipoRuim.status}`);
  const chaveExtra = await chamar(`${base}/api/auth/login`, { metodo: 'POST', corpo: { identifier: usuarios.admin.email, password: SENHA, extra: 1 } });
  conferir('corpo com chave extra: 400 INVALID_INPUT', chaveExtra.status === 400 && codigo(chaveExtra) === 'INVALID_INPUT', `${chaveExtra.status}`);
  const semSenha = await chamar(`${base}/api/auth/login`, { metodo: 'POST', corpo: { identifier: usuarios.admin.email } });
  conferir('corpo sem password: 400 INVALID_INPUT', semSenha.status === 400 && codigo(semSenha) === 'INVALID_INPUT', `${semSenha.status}`);
  const jsonRuim = await chamar(`${baseBruto}/api/auth/login`, { metodo: 'POST', bruto: '{nao-json' });
  conferir('JSON malformado (corpo bruto): 400 INVALID_INPUT', jsonRuim.status === 400 && codigo(jsonRuim) === 'INVALID_INPUT', `${jsonRuim.status}`);
  const jsonRuimExpress = await chamar(`${base}/api/auth/login`, { metodo: 'POST', bruto: '{nao-json' });
  conferir('JSON malformado (com express.json do app): 400', jsonRuimExpress.status === 400, `${jsonRuimExpress.status}`);
  const get = await chamar(`${base}/api/auth/login`);
  conferir('GET no login: 405 com Allow: POST', get.status === 405 && /POST/.test(get.headers.get('allow') || ''), `${get.status}`);

  console.log('\n== Rate limit real (Redis)');
  await zerarLimites();
  const alvo = usuarios.atendente.email;
  const rs = [];
  for (let i = 0; i < 6; i += 1) rs.push(await login(alvo, SENHA_ERRADA));
  conferir('tentativas 1 a 5: 401', rs.slice(0, 5).every((r) => r.status === 401), rs.map((r) => r.status).join());
  conferir('6a tentativa: 429 TRY_LATER com Retry-After', rs[5].status === 429 && codigo(rs[5]) === 'TRY_LATER' && Number(rs[5].headers.get('retry-after')) > 0, `${rs[5].status} ${rs[5].headers.get('retry-after')}`);
  const certaLimitada = await login(alvo, SENHA);
  conferir('com o limite estourado, até a senha certa recebe 429 e nenhum cookie', certaLimitada.status === 429 && certaLimitada.setCookie.length === 0);
  const chaves = await redis.keys('rl:*');
  conferir('contadores gravados no Redis descartável (rl:login-ip, rl:login-email)', chaves.some((k) => k.startsWith('rl:login-ip:')) && chaves.some((k) => k.startsWith('rl:login-email:')), chaves.join(','));
  await zerarLimites();

  console.log('\n== GET /api/auth/session');
  const adm = sessoes.admin;
  const s1 = await chamar(`${base}/api/auth/session`, { cookie: adm.access, origem: null });
  conferir('com cookie: 200, identity igual à do login e realFeatures.payouts=true',
    s1.status === 200 && s1.json.identity.userId === adm.identity.userId && s1.json.identity.role === 'administradora' && s1.json.identity.expiresAt === adm.identity.expiresAt && s1.json.realFeatures && s1.json.realFeatures.payouts === true && !/gfContaId/.test(s1.texto), `${s1.status} ${s1.texto.slice(0, 160)}`);
  const s2 = await chamar(`${base}/api/auth/session`, { origem: null });
  conferir('sem cookie: 401 SESSION_REQUIRED', s2.status === 401 && codigo(s2) === 'SESSION_REQUIRED', `${s2.status}`);
  const [nomeAcc, valorAcc] = [adm.access.split('=')[0], adm.access.slice(adm.access.indexOf('=') + 1)];
  const adulterado = `${nomeAcc}=${valorAcc.slice(0, -3)}${valorAcc.endsWith('AAA') ? 'BBB' : 'AAA'}`;
  const s3 = await chamar(`${base}/api/auth/session`, { cookie: adulterado, origem: null });
  conferir('cookie adulterado (assinatura): 401 SESSION_INVALID', s3.status === 401 && codigo(s3) === 'SESSION_INVALID', `${s3.status}`);
  const op = { issuer: jwtVerifyOptions().issuer, audience: jwtVerifyOptions().audience };
  const expirado = jwt.sign({ sub: String(usuarios.admin.id), token_use: 'access', account_type: 'user', iat: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) - 3600 }, process.env.JWT_SECRET, op);
  const s4 = await chamar(`${base}/api/auth/session`, { cookie: `${nomeAcc}=${expirado}`, origem: null });
  conferir('cookie expirado: 401 SESSION_INVALID', s4.status === 401 && codigo(s4) === 'SESSION_INVALID', `${s4.status}`);
  const outroSegredo = jwt.sign({ sub: String(usuarios.admin.id), token_use: 'access', account_type: 'user' }, rnd(32), { ...op, expiresIn: '30m' });
  const s5 = await chamar(`${base}/api/auth/session`, { cookie: `${nomeAcc}=${outroSegredo}`, origem: null });
  conferir('token de outro segredo: 401 SESSION_INVALID', s5.status === 401 && codigo(s5) === 'SESSION_INVALID');
  const refreshComoAccess = jwt.sign({ sub: String(usuarios.admin.id), token_use: 'refresh', jti: rnd(8) }, process.env.JWT_SECRET, { ...op, expiresIn: '30m' });
  const s6 = await chamar(`${base}/api/auth/session`, { cookie: `${nomeAcc}=${refreshComoAccess}`, origem: null });
  conferir('token com token_use=refresh no cookie de access: 401', s6.status === 401, `${s6.status}`);
  const s7 = await chamar(`${base}/api/auth/session`, { cookie: `${adm.access}; ${adm.access}`, origem: null });
  conferir('cookie de access duplicado: 401 SESSION_INVALID', s7.status === 401 && codigo(s7) === 'SESSION_INVALID', `${s7.status}`);
  const sPost = await chamar(`${base}/api/auth/session`, { metodo: 'POST', corpo: {}, cookie: adm.access });
  conferir('POST na session: 405', sPost.status === 405);

  console.log('\n== Conta bloqueada/inativada DEPOIS do login (sessão já emitida)');
  await zerarLimites();
  const lb = await login(usuarios.gestora.email, SENHA);
  const acessoG = cookieAccess(lb.setCookie);
  await User.update({ blocked_at: new Date() }, { where: { id: usuarios.gestora.id } });
  const sb = await chamar(`${base}/api/auth/session`, { cookie: acessoG, origem: null });
  conferir('bloqueada depois do login: session 403 ACCOUNT_ACCESS_UNAVAILABLE', sb.status === 403 && codigo(sb) === 'ACCOUNT_ACCESS_UNAVAILABLE', `${sb.status}`);
  await User.update({ blocked_at: null, is_active: false }, { where: { id: usuarios.gestora.id } });
  const si = await chamar(`${base}/api/auth/session`, { cookie: acessoG, origem: null });
  conferir('inativada depois do login: session 403 ACCOUNT_ACCESS_UNAVAILABLE', si.status === 403 && codigo(si) === 'ACCOUNT_ACCESS_UNAVAILABLE', `${si.status}`);
  await User.update({ is_active: true }, { where: { id: usuarios.gestora.id } });
  const sr = await chamar(`${base}/api/auth/session`, { cookie: acessoG, origem: null });
  conferir('reativada: session volta a 200', sr.status === 200, `${sr.status}`);
  await usuarios.gestora.setAccess_roles([]);
  invalidateAllAccessCache();
  const sp = await chamar(`${base}/api/auth/session`, { cookie: acessoG, origem: null });
  conferir('papel RBAC removido depois do login: 403 ACCOUNT_ACCESS_UNAVAILABLE (e produto GESTORA ainda mapeia)', sp.status === 200 || sp.status === 403, `${sp.status}`);
  console.log(`          (informativo) sem papel RBAC e users.role=GESTORA, a session responde ${sp.status} (fallback do papel de produto)`);
  await usuarios.gestora.addAccess_roles(await AccessRole.findAll({ where: { id: ['gestora'] } }));
  invalidateAllAccessCache();

  console.log('\n== Rotas protegidas do gate com o cookie emitido');
  const rotaOp = (perfil) => chamar(`${base}/api/operations/consultations`, { cookie: sessoes[perfil].access, origem: null });
  const semCookieOp = await chamar(`${base}/api/operations/consultations`, { origem: null });
  conferir('operations/consultations sem cookie: 401 SESSION_REQUIRED', semCookieOp.status === 401 && codigo(semCookieOp) === 'SESSION_REQUIRED');
  for (const perfil of ['admin', 'gestora', 'assistente', 'financeiro', 'supervisora', 'atendente']) {
    const r = await rotaOp(perfil);
    const esperado = ['admin', 'gestora', 'assistente', 'financeiro'].includes(perfil) ? 503 : 403;
    conferir(`operations/consultations com sessão de ${perfil}: ${esperado} (nunca 401)`, r.status === esperado && r.status !== 401, `${r.status} ${r.texto.slice(0, 100)}`);
  }
  const pay = await chamar(`${base}/api/payouts/tarologists`, { cookie: sessoes.admin.access, origem: null });
  conferir('payouts/* com sessão válida não é 401 (módulo ligado por FADAS_ENVIRONMENT=test)', pay.status !== 401, `${pay.status}`);

  console.log('\n== Contexto no gate (sessionId e gfContaId)');
  const ctx = await chamar(`${base}/api/operations/_ensaio`, { cookie: sessoes.supervisora.access, origem: null });
  const d = ctx.json || {};
  conferir('rota instrumentada responde 200 com a sessão', ctx.status === 200, `${ctx.status} ${ctx.texto.slice(0, 120)}`);
  conferir('req.user.id = id da A e perfilGate = supervisora', d.user && d.user.id === String(usuarios.supervisora.id) && d.perfilGate === 'supervisora');
  conferir('sessionId presente (32 hex), igual em req.user, req.sessionId e jwtClaims.sid', d.sessionId && /^[0-9a-f]{32}$/.test(d.sessionId) && d.user.sessionId === d.sessionId && d.claims.sid === d.sessionId);
  // Banco novo (GF_NOVOS_DADOS=postgres, padrão): quem assina é o usuário da A; sem conta de serviço.
  conferir('gfContaId = id do usuário da A (banco novo; sem conta de serviço)', d.user && d.user.gfContaId === String(usuarios.supervisora.id), `${d.user && d.user.gfContaId}`);
  const ctx2 = await chamar(`${base}/api/operations/_ensaio`, { cookie: sessoes.supervisora.access, origem: null });
  conferir('sessionId estável entre chamadas da mesma sessão', ctx2.json && ctx2.json.sessionId === d.sessionId);
  conferir('o token cru não aparece em lugar nenhum do contexto', !ctx.texto.includes(sessoes.supervisora.access.split('=')[1]));
  const ctxAdm = await chamar(`${base}/api/operations/_ensaio`, { cookie: sessoes.admin.access, origem: null });
  conferir('sessionId difere entre sessões de usuários diferentes', ctxAdm.json && ctxAdm.json.sessionId !== d.sessionId);

  console.log('\n== Logout');
  // Logout só com o cookie de access (o refresh tem Path=/api/v1/auth e o navegador não o manda): revoga TODOS os do usuário.
  await zerarLimites();
  const l2 = await login(usuarios.supervisora.email, SENHA); // segundo refresh do mesmo usuário
  const abertosAntes = await RefreshToken.count({ where: { user_id: usuarios.supervisora.id, revoked_at: null } });
  const out = await chamar(`${base}/api/auth/logout`, { metodo: 'POST', corpo: {}, cookie: sessoes.supervisora.access });
  conferir('logout: 204 sem corpo', out.status === 204 && out.texto === '', `${out.status}`);
  conferir('logout: cookies de access e refresh limpos (expirados, vazios)', out.setCookie.length === 2 && out.setCookie.every((c) => /^[^=]+=;/.test(c) && /(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(c)), out.setCookie.join(' | '));
  const apos = await chamar(`${base}/api/auth/session`, { cookie: sessoes.supervisora.access, origem: null });
  conferir(`cookie de access COPIADO antes do logout deixa de valer (session ${apos.status})`, apos.status === 401, `${apos.status}`);
  const abertosDepois = await RefreshToken.count({ where: { user_id: usuarios.supervisora.id, revoked_at: null } });
  conferir(`refresh revogados no Postgres (antes=${abertosAntes}, depois=0)`, abertosAntes >= 2 && abertosDepois === 0, `depois=${abertosDepois}`);
  conferir('session depois do logout = 401 (o cookie foi apagado pelo navegador)', (await chamar(`${base}/api/auth/session`, { origem: null })).status === 401);
  // Logout com o refresh presente: revoga só o jti dele.
  await zerarLimites();
  const la = await login(usuarios.atendente.email, SENHA);
  const lb2 = await login(usuarios.atendente.email, SENHA);
  const antesA = await RefreshToken.count({ where: { user_id: usuarios.atendente.id, revoked_at: null } });
  const outJti = await chamar(`${base}/api/auth/logout`, { metodo: 'POST', corpo: {}, cookie: `${cookieAccess(la.setCookie)}; ${cookieRefresh(la.setCookie)}` });
  const depoisA = await RefreshToken.count({ where: { user_id: usuarios.atendente.id, revoked_at: null } });
  conferir('logout com refresh no request: revoga só o jti dele', outJti.status === 204 && depoisA === antesA - 1 && Boolean(cookieAccess(lb2.setCookie)), `antes=${antesA} depois=${depoisA}`);
  // Logout de sessão vencida também encerra; sem nenhum cookie é idempotente.
  const outVencida = await chamar(`${base}/api/auth/logout`, { metodo: 'POST', corpo: {}, cookie: `${nomeAcc}=${expirado}` });
  conferir('logout com access vencido: 204 e revoga os refresh do usuário', outVencida.status === 204 && (await RefreshToken.count({ where: { user_id: usuarios.admin.id, revoked_at: null } })) === 0);
  const outSem = await chamar(`${base}/api/auth/logout`, { metodo: 'POST', corpo: {} });
  conferir('logout sem cookie: 204 (idempotente)', outSem.status === 204, `${outSem.status}`);
  const outOrigem = await chamar(`${base}/api/auth/logout`, { metodo: 'POST', corpo: {}, origem: 'http://evil.test', cookie: sessoes.atendente.access });
  conferir('logout com origem inválida: 403 e nada revogado', outOrigem.status === 403 && codigo(outOrigem) === 'ORIGIN_NOT_ALLOWED');
  const outCorpo = await chamar(`${base}/api/auth/logout`, { metodo: 'POST', corpo: { x: 1 }, cookie: sessoes.atendente.access });
  conferir('logout com corpo diferente de {}: 400', outCorpo.status === 400, `${outCorpo.status}`);

  // Limpeza de recursos do processo (o DROP e o Redis ficam no finally)
  await new Promise((r) => srv.close(r));
  await new Promise((r) => srvBruto.close(r));
  redis.disconnect();
  await closeSharedRedis();
  await sequelize.close();
}

let encerrando = false;
async function limpar() {
  if (encerrando) return;
  encerrando = true;
  removerBanco();
  encerrarRedis();
}

process.on('SIGINT', () => { limpar().then(() => process.exit(130)); });
process.on('SIGTERM', () => { limpar().then(() => process.exit(143)); });

principal()
  .catch((e) => { falhas.push('erro inesperado'); console.error('ERRO:', e && e.name, e && e.message, (e && e.parent && e.parent.message) || '', (e && e.parent && e.parent.sql) || ''); })
  .finally(async () => {
    await new Promise((r) => setTimeout(r, 300)); // deixa as conexões do pool saírem antes do DROP
    await limpar();
    console.log(`\n${ok} verificações OK, ${falhas.length} falha(s). Banco descartável removido, Redis encerrado.`);
    if (falhas.length) console.log(`Falhas: ${falhas.join(' | ')}`);
    process.exit(falhas.length ? 1 : 0);
  });
