'use strict';

/** Verifica o provider da Umbler sem rede: adaptador falso do axios e variáveis de ambiente controladas. */
const assert = require('node:assert/strict');
const axios = require('axios');

const chamadas = [];
let resposta = { status: 200, data: { ok: true } };
axios.defaults.adapter = async (cfg) => {
  chamadas.push({ method: cfg.method, url: cfg.url, auth: cfg.headers.Authorization, params: cfg.params, data: cfg.data });
  if (resposta.status >= 400) {
    const e = new Error('falha'); e.response = { status: resposta.status, data: { segredo: 'dado-de-cliente' } }; throw e;
  }
  return { status: resposta.status, data: resposta.data, headers: {}, config: cfg };
};

const u = require('../src/providers/umbler/umbler.client');
const { verifyUmblerWebhook } = require('../src/providers/umbler/umbler.webhook.auth');

const TOKEN = 'token-secreto-de-teste';
const limpar = () => { for (const k of ['UMBLER_API_TOKEN', 'UMBLER_ORGANIZATION_ID', 'UMBLER_ESCRITA_ENABLED', 'UMBLER_WEBHOOK_TOKEN', 'UMBLER_WEBHOOK_AUTH_DISABLED']) delete process.env[k]; chamadas.length = 0; resposta = { status: 200, data: { ok: true } }; };
const falha = async (fn, codigo, frase) => { try { await fn(); } catch (e) { assert.equal(e.codigo, codigo, frase); return e; } assert.fail(frase); };
let n = 0; const ok = (m) => { n += 1; console.log(`ok ${n} - ${m}`); };

(async () => {
  limpar();
  await falha(() => u.listarRobos(), 'UMBLER_SEM_TOKEN', 'sem token a chamada é recusada'); ok('sem token recusa');
  process.env.UMBLER_API_TOKEN = TOKEN;
  await falha(() => u.listarRobos(), 'UMBLER_SEM_ORGANIZACAO', 'sem organização recusa'); ok('sem organização recusa');
  process.env.UMBLER_ORGANIZATION_ID = 'ORG1';

  await u.lerContato('C 1/x');
  assert.equal(chamadas[0].method, 'get'); assert.equal(chamadas[0].url, '/v1/contacts/C%201%2Fx/'); assert.equal(chamadas[0].auth, `Bearer ${TOKEN}`); assert.equal(chamadas[0].params.organizationId, 'ORG1');
  ok('leitura usa Bearer, organização e id escapado');

  chamadas.length = 0;
  await falha(() => u.criarNota('C1', 'oi'), 'UMBLER_ESCRITA_DESLIGADA', 'escrita desligada por padrão');
  assert.equal(chamadas.length, 0, 'nada saiu da API'); ok('escrita desligada não faz chamada');

  process.env.UMBLER_ESCRITA_ENABLED = 'true';
  await falha(() => u.criarNota('C1', '   '), 'UMBLER_NOTA_VAZIA', 'nota vazia recusada'); assert.equal(chamadas.length, 0); ok('nota vazia recusada antes de sair');
  await u.criarNota('C1', '  Agendada com Selene - 6ª da fila  ');
  assert.equal(chamadas[0].method, 'post'); assert.equal(chamadas[0].url, '/v1/contacts/C1/notes/');
  assert.deepEqual(JSON.parse(chamadas[0].data), { content: 'Agendada com Selene - 6ª da fila', organizationId: 'ORG1' }); ok('nota enviada com texto aparado e organização');

  resposta = { status: 500, data: {} };
  const e = await falha(() => u.listarNotas('C1'), 'UMBLER_HTTP', 'erro HTTP traduzido');
  assert.equal(e.status, 500); assert.ok(!e.message.includes(TOKEN) && !e.message.includes('dado-de-cliente') && !JSON.stringify(e).includes('dado-de-cliente')); ok('erro não vaza token nem corpo');

  // leitura para conferir evento
  resposta = { status: 200, data: { organization: { id: 'ORG1' }, contact: { id: 'K1', tags: [{ id: 't' }], phone: '5588999990000' } } };
  const conversa = await u.lerConversa('chat 1');
  assert.deepEqual(conversa, { organizationId: 'ORG1', contact: { id: 'K1', tags: [{ id: 't' }] } });
  assert.equal(JSON.stringify(conversa).includes('5588999990000'), false);
  assert.equal(chamadas.at(-1).url, '/v1/chats/chat%201/'); ok('lerConversa: só organização e contato (sem telefone), id escapado');
  resposta = { status: 200, data: { id: 'M1', isPrivate: true, source: 'Member', sentByOrganizationMember: { id: 'U1' }, fromContact: false, content: 'zx', eventAtUTC: '2026-11-07T10:00:00Z', automated: false, extra: 'nao-sai' } };
  const msg = await u.lerMensagem('chat1', 'M1');
  assert.equal(msg.isPrivate, true); assert.equal(msg.eventAt, '2026-11-07T10:00:00Z'); assert.equal(msg.content, 'zx'); assert.equal('extra' in msg, false); ok('lerMensagem: campos que o resolve usa, e nada além');
  resposta = { status: 404, data: {} };
  const e404 = await falha(() => u.lerMensagem('chat1', 'M2'), 'UMBLER_HTTP', 'mensagem inexistente'); assert.equal(e404.status, 404); ok('mensagem inexistente: erro com status 404 (vira 422 no resolve)');
  resposta = { status: 200, data: { ok: true } };

  // webhook
  const passa = (headers) => new Promise((res) => verifyUmblerWebhook({ get: (h) => headers[h] }, {}, (err) => res(err ? err.statusCode || err.status : 'next')));
  limpar();
  assert.equal(await passa({}), 503); ok('webhook sem token configurado: 503');
  process.env.UMBLER_WEBHOOK_TOKEN = 'segredo-do-webhook';
  assert.equal(await passa({}), 401); assert.equal(await passa({ 'x-umbler-webhook-token': 'errado' }), 401); ok('webhook sem credencial ou errada: 401');
  assert.equal(await passa({ 'x-umbler-webhook-token': 'segredo-do-webhook' }), 'next'); ok('webhook com token certo passa');
  limpar();
  console.log(`\n${n} verificações passaram.`);
})().catch((err) => { console.error('FALHOU:', err.message); process.exit(1); });
