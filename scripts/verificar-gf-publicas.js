'use strict';

/**
 * Verificação OFFLINE das rotas públicas do gate (`/welcome`, `/tarologos-cadastro`): sobe o router num Express efêmero
 * (127.0.0.1, porta livre), sem banco e sem sessão, e compara status, cabeçalhos e corpo com o que a B (Node) devolve.
 *
 * Os bytes do JSON padrão do welcome são comparados com a captura ao vivo de https://gestao-dev.fadasdobem.com.br/api/welcome
 * (SHA-256 fixo abaixo, de `curl -s`). Se `WELCOME_AO_VIVO=<arquivo>` apontar para uma captura nova, ela também é conferida.
 *
 *   node scripts/verificar-gf-publicas.js
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { criarRotasPublicas } = require('../src/gestao-fadas/gate/rotas-publicas');

const SHA_WELCOME_B = '8b6969336679de1e71cf41dc40b1a326b6c2af14932535964a106654da29564f';
const TAMANHO_WELCOME_B = 5261;
const MSG_WELCOME = 'A edição dos textos da entrada ainda não está integrada neste ambiente. A entrada usa os textos padrão.';
const MSG_CADASTRO = 'O recebimento de cadastros ainda não está integrado neste ambiente.';

function chamar(porta, metodo, caminho, cabecalhos = {}, corpo) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers: cabecalhos }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => resolve({ status: res.statusCode, h: res.headers, bytes: Buffer.concat(partes) }));
    });
    req.on('error', reject);
    req.end(corpo);
  });
}

let ok = 0;
const passo = (nome, fn) => { fn(); ok += 1; console.log(`ok  ${nome}`); };

(async () => {
  const app = express();
  app.use('/api', criarRotasPublicas());
  const servidor = await new Promise((r) => { const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s)); });
  const porta = servidor.address().port;
  const welcomeHeaders = (r) => {
    assert.strictEqual(r.h['content-type'], 'application/json');
    assert.strictEqual(r.h['cache-control'], 'no-store');
    assert.strictEqual(r.h.vary, 'Cookie');
    assert.strictEqual(r.h.etag, undefined);
    assert.strictEqual(r.h['x-powered-by'], undefined);
  };
  const cadastroHeaders = (r) => {
    assert.strictEqual(r.h['content-type'], 'application/json');
    assert.strictEqual(r.h['cache-control'], 'no-store');
    assert.strictEqual(r.h['referrer-policy'], 'no-referrer');
    assert.strictEqual(r.h['x-content-type-options'], 'nosniff');
    assert.strictEqual(r.h.etag, undefined);
    assert.strictEqual(r.h['x-powered-by'], undefined);
  };
  try {
    const g = await chamar(porta, 'GET', '/api/welcome');
    passo('GET /welcome: 200, cabeçalhos da B', () => { assert.strictEqual(g.status, 200); welcomeHeaders(g); });
    passo('GET /welcome: bytes iguais aos da B ao vivo (tamanho e SHA-256)', () => {
      assert.strictEqual(g.bytes.length, TAMANHO_WELCOME_B);
      assert.strictEqual(crypto.createHash('sha256').update(g.bytes).digest('hex'), SHA_WELCOME_B);
    });
    passo('GET /welcome: revision 0, 8 saudações e 24 mensagens ativas', () => {
      const j = JSON.parse(g.bytes.toString('utf8'));
      assert.strictEqual(j.revision, 0);
      assert.strictEqual(j.content.greetings.length, 8);
      assert.strictEqual(j.content.messages.length, 24);
      assert.ok(j.content.greetings.concat(j.content.messages).every((r) => r.active === true));
    });
    const captura = process.env.WELCOME_AO_VIVO;
    if (captura && fs.existsSync(captura)) {
      passo(`GET /welcome: bytes iguais à captura ${captura}`, () => assert.ok(g.bytes.equals(fs.readFileSync(captura))));
    }
    const gi = await chamar(porta, 'GET', '/api/welcome', { 'oai-authenticated-user-email': 'a@b.c' });
    passo('GET /welcome com cabeçalho de identidade: mesmo corpo público', () => assert.ok(gi.bytes.equals(g.bytes)));
    const h = await chamar(porta, 'HEAD', '/api/welcome');
    passo('HEAD /welcome: 200 sem corpo', () => { assert.strictEqual(h.status, 200); assert.strictEqual(h.bytes.length, 0); assert.strictEqual(h.h['content-type'], 'application/json'); });

    const msgWelcome = JSON.stringify({ error: MSG_WELCOME });
    for (const [metodo, caminho, cab] of [
      ['GET', '/api/welcome?editor=1', {}], ['GET', '/api/welcome?editor=1', { 'oai-authenticated-user-email': 'a@b.c' }],
      ['PUT', '/api/welcome', {}], ['PUT', '/api/welcome', { 'content-type': 'application/json', origin: 'http://x' }],
    ]) {
      const r = await chamar(porta, metodo, caminho, cab, metodo === 'PUT' ? '{}' : undefined);
      passo(`${metodo} ${caminho}: 503 com a mensagem da B`, () => { assert.strictEqual(r.status, 503); welcomeHeaders(r); assert.strictEqual(r.bytes.toString('utf8'), msgWelcome); });
    }
    const ed0 = await chamar(porta, 'GET', '/api/welcome?editor=0');
    passo('GET /welcome?editor=0: público (200)', () => { assert.strictEqual(ed0.status, 200); assert.ok(ed0.bytes.equals(g.bytes)); });

    const msgCad = JSON.stringify({ error: MSG_CADASTRO });
    for (const m of ['GET', 'POST', 'PUT']) {
      const r = await chamar(porta, m, '/api/tarologos-cadastro', m === 'GET' ? {} : { 'content-type': 'application/json' }, m === 'GET' ? undefined : '{}');
      passo(`${m} /tarologos-cadastro: 503 com a mensagem da B`, () => { assert.strictEqual(r.status, 503); cadastroHeaders(r); assert.strictEqual(r.bytes.toString('utf8'), msgCad); });
    }
    const r405 = [await chamar(porta, 'POST', '/api/welcome'), await chamar(porta, 'DELETE', '/api/welcome'), await chamar(porta, 'DELETE', '/api/tarologos-cadastro'), await chamar(porta, 'PATCH', '/api/tarologos-cadastro')];
    passo('métodos fora da rota: 405 vazio, sem Allow', () => r405.forEach((r) => { assert.strictEqual(r.status, 405); assert.strictEqual(r.bytes.length, 0); assert.strictEqual(r.h.allow, undefined); }));
    const o1 = await chamar(porta, 'OPTIONS', '/api/welcome');
    const o2 = await chamar(porta, 'OPTIONS', '/api/tarologos-cadastro');
    passo('OPTIONS: 204 com Allow da B', () => { assert.strictEqual(o1.status, 204); assert.strictEqual(o1.h.allow, 'GET, HEAD, OPTIONS, PUT'); assert.strictEqual(o2.status, 204); assert.strictEqual(o2.h.allow, 'GET, HEAD, OPTIONS, POST, PUT'); });
  } finally {
    await new Promise((r) => servidor.close(r));
  }
  console.log(`\n${ok} verificações passaram.`);
})().catch((e) => { console.error(e); process.exit(1); });
