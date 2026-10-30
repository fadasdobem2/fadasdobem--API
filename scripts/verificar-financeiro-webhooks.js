'use strict';

/**
 * Verificação OFFLINE dos webhooks financeiros (F-01 Chatwoot, F-03 Agora NCS): sem banco, sem rede externa e
 * sem ler segredo de .env. Sobe Express efêmero (127.0.0.1) com serviços simulados e confere assinatura válida,
 * inválida, ausente, replay, janela de tempo, ausência de segredo (fail closed), valor absurdo, remetente não
 * autorizado, idempotência do /lancar_pagamento e ausência de segredo nos logs.
 *
 *   node scripts/verificar-financeiro-webhooks.js
 */

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const request = require('supertest');

// Segredos FALSOS, só deste processo. Nada de Redis: cai na memória do processo.
const SEG_CW = 'segredo-falso-chatwoot-0123456789abcdef';
const TOKEN_CW = 'token-falso-chatwoot-0123456789abcdef';
const SEG_AG = 'segredo-falso-agora-0123456789abcdef';
for (const k of ['REDIS_URL', 'REDIS_HOST', 'NODE_ENV', 'CHATWOOT_WEBHOOK_AUTH_DISABLED', 'AGORA_NCS_VERIFY_DISABLED']) delete process.env[k];
delete process.env.CHATWOOT_WEBHOOK_SECRET;
delete process.env.CHATWOOT_WEBHOOK_TOKEN;
delete process.env.AGORA_NCS_SECRET;

// Captura de logs para provar que nenhum segredo vaza.
const logs = [];
for (const m of ['log', 'warn', 'error']) {
  const orig = console[m].bind(console);
  console[m] = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); if (process.env.VERBOSE) orig(...a); };
}

function stub(rel, exports) {
  const f = require.resolve(path.join('..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports };
}

let chamadasChatwoot = 0;
let chamadasAgora = 0;
stub('src/features/chatwoot/chatwoot.service.js', {
  processWebhookEnvelope: async () => { chamadasChatwoot += 1; return { ok: true }; },
});
stub('src/features/sessions/sessions.service.js', {
  summarizeNcsBodyForLog: () => ({}),
  processAgoraNcsWebhookAsync: async () => { chamadasAgora += 1; },
});
stub('src/middlewares/auth.middleware.js', (_q, _r, n) => n());

const guard = require('../src/features/chatwoot/webhook.guard');
const chatwootRoutes = require('../src/features/chatwoot/chatwoot.routes');
const sessionsRoutes = require('../src/features/sessions/sessions.routes');

function criarApp() {
  const app = express();
  // Igual ao que o app.js deve fazer: preservar o corpo bruto para a verificação HMAC.
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/chatwoot', chatwootRoutes);
  app.use('/sessions', sessionsRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ sucesso: false }));
  return app;
}

const app = criarApp();
const agora = () => Math.floor(Date.now() / 1000);
const hex = (alg, seg, d) => crypto.createHmac(alg, seg).update(d).digest('hex');
const cwEnvio = (corpoTxt, { seg = SEG_CW, ts = agora(), id = crypto.randomUUID(), assinar = true } = {}) => {
  const r = request(app).post('/chatwoot/webhook').set('Content-Type', 'application/json').set('X-Chatwoot-Delivery', id);
  if (assinar) r.set('X-Chatwoot-Timestamp', String(ts)).set('X-Chatwoot-Signature', `sha256=${hex('sha256', seg, `${ts}.${corpoTxt}`)}`);
  return r.send(corpoTxt);
};
const agEnvio = (obj, { seg = SEG_AG, assinar = true, assinaturaCustom } = {}) => {
  const txt = JSON.stringify(obj, null, 1); // formato "diferente" de propósito: só o corpo bruto confere
  const r = request(app).post('/sessions/agora-webhook').set('Content-Type', 'application/json');
  if (assinar) r.set('Agora-Signature-V2', assinaturaCustom || hex('sha256', seg, txt));
  return r.send(txt);
};

let n = 0;
const ok = (nome) => { n += 1; process.stdout.write(`  ok ${n} ${nome}\n`); };

async function chatwootAuth() {
  const corpo = JSON.stringify({ event: 'message_created', content: 'oi' });

  // Sem segredo nenhum: fail closed.
  let r = await cwEnvio(corpo);
  assert.strictEqual(r.status, 503); assert.strictEqual(chamadasChatwoot, 0); ok('chatwoot sem segredo configurado = 503');
  // Bypass pedido em produção: ignorado.
  process.env.CHATWOOT_WEBHOOK_AUTH_DISABLED = 'true'; process.env.NODE_ENV = 'production';
  r = await cwEnvio(corpo, { assinar: false });
  assert.strictEqual(r.status, 503); ok('flag de bypass ignorado em produção');
  delete process.env.NODE_ENV;
  r = await cwEnvio(corpo, { assinar: false });
  assert.strictEqual(r.status, 200); assert.strictEqual(chamadasChatwoot, 1); ok('flag de bypass explícito só fora de produção');
  delete process.env.CHATWOOT_WEBHOOK_AUTH_DISABLED; chamadasChatwoot = 0;

  process.env.CHATWOOT_WEBHOOK_SECRET = SEG_CW;
  r = await cwEnvio(corpo, { assinar: false });
  assert.strictEqual(r.status, 401); ok('chatwoot sem assinatura = 401');
  r = await cwEnvio(corpo);
  assert.strictEqual(r.status, 200); assert.strictEqual(chamadasChatwoot, 1); ok('chatwoot assinatura válida = 200 e processa');
  r = await cwEnvio(corpo, { seg: 'outro-segredo' });
  assert.strictEqual(r.status, 401); ok('chatwoot assinatura inválida = 401');
  r = await cwEnvio(corpo).set('X-Chatwoot-Signature', `sha256=${'0'.repeat(64)}`);
  assert.strictEqual(r.status, 401); ok('chatwoot assinatura forjada = 401');
  r = await cwEnvio(corpo).set('X-Chatwoot-Signature', 'lixo');
  assert.strictEqual(r.status, 401); ok('chatwoot assinatura malformada = 401');
  r = await cwEnvio(corpo, { ts: agora() - 3600 });
  assert.strictEqual(r.status, 401); ok('chatwoot timestamp antigo (assinado) = 401');
  const alterado = await request(app).post('/chatwoot/webhook').set('Content-Type', 'application/json')
    .set('X-Chatwoot-Timestamp', String(agora())).set('X-Chatwoot-Signature', `sha256=${hex('sha256', SEG_CW, `${agora()}.${corpo}`)}`).send(corpo.replace('oi', 'tchau'));
  assert.strictEqual(alterado.status, 401); ok('chatwoot corpo adulterado = 401');

  chamadasChatwoot = 0;
  const id = crypto.randomUUID();
  r = await cwEnvio(corpo, { id }); assert.strictEqual(r.status, 200);
  r = await cwEnvio(corpo, { id });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.dados.duplicado, true); assert.strictEqual(chamadasChatwoot, 1);
  ok('chatwoot replay do mesmo delivery = 200 sem reprocessar');

  // Modo token compartilhado.
  delete process.env.CHATWOOT_WEBHOOK_SECRET; process.env.CHATWOOT_WEBHOOK_TOKEN = TOKEN_CW; chamadasChatwoot = 0;
  const comToken = (t) => request(app).post('/chatwoot/webhook').set('X-Chatwoot-Webhook-Token', t).send({ event: 'x' });
  assert.strictEqual((await comToken(TOKEN_CW)).status, 200); assert.strictEqual(chamadasChatwoot, 1);
  assert.strictEqual((await comToken('errado')).status, 401);
  assert.strictEqual((await request(app).post('/chatwoot/webhook').send({})).status, 401);
  ok('chatwoot token compartilhado: certo=200, errado/ausente=401');
  delete process.env.CHATWOOT_WEBHOOK_TOKEN;
}

async function agoraAuth() {
  const ev = (extra = {}) => ({ noticeId: `2000001428:${crypto.randomUUID()}:103`, productId: 1, eventType: 103, notifyMs: Date.now(), payload: { channelName: 'c', uid: 1, ts: agora() }, ...extra });
  let r = await agEnvio(ev());
  assert.strictEqual(r.status, 503); assert.strictEqual(chamadasAgora, 0); ok('agora sem segredo configurado = 503');

  process.env.AGORA_NCS_SECRET = SEG_AG;
  r = await agEnvio(ev(), { assinar: false });
  assert.strictEqual(r.status, 401); ok('agora sem assinatura = 401');
  r = await agEnvio(ev(), { seg: 'outro' });
  assert.strictEqual(r.status, 401); ok('agora assinatura inválida = 401');
  r = await agEnvio(ev(), { assinaturaCustom: 'abc' });
  assert.strictEqual(r.status, 401); ok('agora assinatura malformada = 401');

  chamadasAgora = 0;
  const bom = ev();
  r = await agEnvio(bom);
  assert.strictEqual(r.status, 200);
  await new Promise((res) => setImmediate(res)); await new Promise((res) => setImmediate(res));
  assert.strictEqual(chamadasAgora, 1); ok('agora assinatura válida = 200 e processa');
  r = await agEnvio(bom);
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.dados.duplicado, true);
  await new Promise((res) => setImmediate(res));
  assert.strictEqual(chamadasAgora, 1); ok('agora replay do mesmo noticeId = 200 sem reprocessar');
  r = await agEnvio(ev({ notifyMs: Date.now() - 3600 * 1000 }));
  assert.strictEqual(r.status, 401); ok('agora notifyMs fora da janela = 401');
  const forjado = ev(); forjado.payload.reason = 'SERVER error';
  r = await request(app).post('/sessions/agora-webhook').set('Content-Type', 'application/json').set('Agora-Signature-V2', hex('sha256', SEG_AG, JSON.stringify(ev()))).send(forjado);
  assert.strictEqual(r.status, 401); ok('agora 104 forjado com assinatura de outro corpo = 401');
  delete process.env.AGORA_NCS_SECRET;
}

async function politicaLancar() {
  const pol = require('../src/features/chatwoot/chatwoot.lancar.policy');
  const ctx = (o = {}) => ({ messageId: 'm1', senderId: '7', senderType: 'user', ...o });

  assert.strictEqual(pol.autorizarRemetente(ctx()).ok, false); ok('lista de agentes vazia = ninguém autorizado');
  process.env.CHATWOOT_LANCAR_PAGAMENTO_AGENT_IDS = '7, 9';
  assert.strictEqual(pol.autorizarRemetente(ctx()).ok, true);
  assert.strictEqual(pol.autorizarRemetente(ctx({ senderId: '8' })).ok, false);
  assert.strictEqual(pol.autorizarRemetente(ctx({ senderType: 'agent_bot' })).ok, false);
  assert.strictEqual(pol.autorizarRemetente(ctx({ senderType: 'contact' })).ok, false);
  assert.strictEqual(pol.autorizarRemetente(ctx({ messageId: null })).ok, false);
  assert.strictEqual(pol.autorizarRemetente(null).ok, false); ok('remetente: só user listado e com message id');

  for (const v of [0, -5, NaN, 'abc', 5000, 500.01, 10.123, Infinity]) assert.strictEqual(pol.validarValorLivre(v).ok, false, `valor ${v}`);
  for (const v of [1, 49.99, 500]) assert.strictEqual(pol.validarValorLivre(v).ok, true, `valor ${v}`);
  ok('valor: absurdo, negativo, NaN, 3 casas e acima do teto recusados');

  assert.strictEqual(await pol.reservarTetoDiario('7', 1500), true);
  assert.strictEqual(await pol.reservarTetoDiario('7', 600), false);
  assert.strictEqual(await pol.reservarTetoDiario('7', 500), true);
  await pol.devolverTetoDiario('7', 500);
  assert.strictEqual(await pol.reservarTetoDiario('7', 500), true); ok('teto diário por agente com reserva e devolução');
}

async function comandoLancar() {
  const models = require('../src/models');
  const paymentsService = require('../src/features/payments/payments.service');
  const chatwootClient = require('../src/providers/chatwoot/chatwoot.client');
  const pol = require('../src/features/chatwoot/chatwoot.lancar.policy');
  const commands = require('../src/features/chatwoot/chatwoot.commands');
  guard._limparMemoriaParaTeste();

  const notas = []; const audits = []; let creditos = 0; let falhar = false;
  chatwootClient.postPrivateNote = async (_a, _c, t) => { notas.push(t); };
  models.User.findOne = async () => ({ id: 'u1', role: 'CLIENTE', client_profile: { id: 'cl1' } });
  paymentsService.approveManualAttendancePayment = async (_u, body) => {
    if (falhar) throw new Error('falha simulada');
    creditos += 1; return { payment_order_id: `ord-${creditos}`, amount_brl: body.amount };
  };
  pol._setAuditoriaParaTeste(async (p) => { audits.push(p); });
  process.env.CHATWOOT_LANCAR_PAGAMENTO_AGENT_IDS = '7';
  const run = (txt, ctx) => commands.handleCommand(txt, 'acc', 'conv', '55', ctx);
  const ctx = (o = {}) => ({ messageId: 'm1', senderId: '7', senderType: 'user', ...o });

  await run('/lancar_pagamento 100', ctx());
  assert.strictEqual(creditos, 1); assert.strictEqual(audits.length, 1); assert.strictEqual(audits[0].action, 'CHATWOOT_LANCAR_PAGAMENTO');
  assert.strictEqual(audits[0].target_id, 'ord-1'); ok('lançamento válido credita uma vez e audita');
  await run('/lancar_pagamento 100', ctx());
  assert.strictEqual(creditos, 1); ok('mesma mensagem reenviada não duplica o crédito');
  await run('/lancar_pagamento 100', ctx({ messageId: 'm2' }));
  assert.strictEqual(creditos, 2); ok('outra mensagem é outro lançamento');
  await run('/lancar_pagamento 5000', ctx({ messageId: 'm3' }));
  assert.strictEqual(creditos, 2); assert.strictEqual(audits.at(-1).action, 'CHATWOOT_LANCAR_PAGAMENTO_NEGADO'); ok('valor absurdo recusado e auditado');
  await run('/lancar_pagamento 10', ctx({ messageId: 'm4', senderId: '99' }));
  assert.strictEqual(creditos, 2); ok('agente fora da lista recusado');
  await run('/lancar_pagamento 10', ctx({ messageId: 'm5', senderType: 'contact' }));
  await run('/lancar_pagamento 10', null);
  assert.strictEqual(creditos, 2); ok('cliente (contact) ou sem contexto não lança');
  falhar = true;
  await run('/lancar_pagamento 20', ctx({ messageId: 'm6' }));
  falhar = false;
  await run('/lancar_pagamento 20', ctx({ messageId: 'm6' }));
  assert.strictEqual(creditos, 3); ok('falha no crédito libera a mensagem para nova tentativa');
  assert.ok(notas.length > 0);
  delete process.env.CHATWOOT_LANCAR_PAGAMENTO_AGENT_IDS;
}

(async () => {
  try {
    await chatwootAuth();
    await agoraAuth();
    await politicaLancar();
    await comandoLancar();
    const tudo = logs.join('\n');
    for (const s of [SEG_CW, TOKEN_CW, SEG_AG]) assert.ok(!tudo.includes(s), 'segredo vazou em log');
    ok('nenhum segredo nos logs');
    process.stdout.write(`\nverificar-financeiro-webhooks: ${n} verificações OK\n`);
    process.exit(0);
  } catch (e) {
    process.stderr.write(`FALHOU: ${e.stack || e}\n`);
    process.exit(1);
  }
})();
