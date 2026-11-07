'use strict';

/** Verifica a base da API da Lilly (Maturacao/59): token de serviço, flag, semântica 4xx/5xx, idempotência e status. Sem rede externa nem banco. */
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { criarRotasLilly } = require('../src/gestao-fadas/gate/rotas-lilly');
const { normalizarChave, hashDaAcao } = require('../src/gestao-fadas/features/lilly/idempotencia/chave');
const { traduzirStatusConsulta } = require('../src/gestao-fadas/features/lilly/consultas/status');

const TOKEN = 'token-de-teste-com-mais-de-24-caracteres';
const ENV = ['GF_FATIA_LILLY', 'LILLY_SERVICE_TOKEN', 'GF_LILLY_ACOES_ENABLED'];
const limpar = () => ENV.forEach((k) => delete process.env[k]);
let n = 0; const ok = (m) => { n += 1; console.log(`ok ${n} - ${m}`); };

const app = express();
app.use('/api', criarRotasLilly());
const servidor = http.createServer(app);

async function chamar(metodo, caminho, { token = TOKEN, corpo, cabecalhos = {}, bruto } = {}) {
  const { port } = servidor.address();
  const r = await fetch(`http://127.0.0.1:${port}/api${caminho}`, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...((corpo !== undefined || bruto !== undefined) ? { 'Content-Type': 'application/json' } : {}), ...cabecalhos },
    ...(bruto !== undefined ? { body: bruto } : corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  return { status: r.status, corpo: texto ? JSON.parse(texto) : null };
}

(async () => {
  await new Promise((res) => servidor.listen(0, '127.0.0.1', res));
  const muteLog = console.warn; const muteErr = console.error; console.warn = () => {}; console.error = () => {};
  try {
    limpar();
    assert.equal((await chamar('POST', '/lilly/context', { corpo: { event: {} } })).status, 404); ok('flag desligada: 404');

    process.env.GF_FATIA_LILLY = 'true';
    assert.equal((await chamar('POST', '/lilly/context', { corpo: { event: {} } })).status, 503); ok('sem token configurado: 503');
    process.env.LILLY_SERVICE_TOKEN = 'curto';
    assert.equal((await chamar('POST', '/lilly/context', { token: 'curto', corpo: { event: {} } })).status, 503); ok('token configurado curto demais: 503');

    process.env.LILLY_SERVICE_TOKEN = TOKEN;
    assert.equal((await chamar('POST', '/lilly/context', { token: null, corpo: { event: {} } })).status, 401); ok('sem credencial: 401');
    assert.equal((await chamar('POST', '/lilly/context', { token: 'errado-errado-errado-errado', corpo: { event: {} } })).status, 401); ok('credencial errada: 401');

    const ctx = await chamar('POST', '/lilly/context', { corpo: { event: { type: 'x' } } });
    assert.equal(ctx.status, 200); assert.equal(ctx.corpo.complete, false); assert.equal(ctx.corpo.operationalStartHour, 6);
    assert.match(ctx.corpo.now, /^\d{4}-\d{2}-\d{2}T/); assert.match(ctx.corpo.operationalDate, /^\d{4}-\d{2}-\d{2}$/);
    for (const k of ['clients', 'tarologists', 'appointments', 'consultations', 'payments', 'links', 'messages']) assert.deepEqual(ctx.corpo[k], []);
    ok('contexto: incompleto (complete:false), com relógio e dia operacional, arrays vazios');
    assert.equal((await chamar('POST', '/lilly/context', { corpo: {} })).status, 400); ok('contexto sem evento: 400');

    assert.equal((await chamar('POST', '/lilly/events/resolve', { corpo: { provider: 'x', event: {} } })).status, 400);
    // Mudou de propósito (fatia de dados): o resolve agora valida o webhook e confere na Umbler/banco (verificar-gf-lilly-dados.js cobre o fluxo completo).
    const semTipo = await chamar('POST', '/lilly/events/resolve', { corpo: { provider: 'umbler', event: { id: '1' } } });
    assert.equal(semTipo.status, 400); assert.equal(semTipo.corpo.error.code, 'INVALID_INPUT');
    assert.equal((await chamar('POST', '/lilly/events/resolve', { corpo: { provider: 'fadas', event: { id: '1' } } })).status, 400); ok('resolve: aceita umbler e fadas, forma inválida é 400 (nunca 5xx)');

    const val = await chamar('POST', '/lilly/actions/validate', { corpo: { action: { kind: 'schedule' } } });
    assert.equal(val.status, 200); assert.equal(val.corpo.allowed, false); assert.ok(val.corpo.reason); ok('validate: allowed:false com motivo (200)');

    assert.equal((await chamar('POST', '/lilly/actions', { corpo: { action: { kind: 'schedule' } } })).status, 400); ok('ação sem Idempotency-Key: 400');
    const longa = `evento-${'x'.repeat(300)}:sufixo:conversa`;
    const desligada = await chamar('POST', '/lilly/actions', { corpo: { action: { kind: 'schedule' } }, cabecalhos: { 'Idempotency-Key': longa } });
    assert.equal(desligada.status, 403); assert.equal(desligada.corpo.error.code, 'LILLY_ACTIONS_DISABLED'); ok('ações desligadas: 403 (nunca executa), chave longa aceita');
    process.env.GF_LILLY_ACOES_ENABLED = 'true';
    // Mudou de propósito: `schedule` agora TEM executor (features/lilly/executores). O 422 "sem executor" passou a ser provado com um kind só-Umbler (nunca executa no Gestão).
    const naoSuportada = await chamar('POST', '/lilly/actions', { corpo: { action: { kind: 'note' } }, cabecalhos: { 'Idempotency-Key': 'chave-valida-123' } });
    assert.equal(naoSuportada.status, 422); ok('ações ligadas mas kind sem executor no Gestão (só-Umbler): 422 (nunca 5xx)');

    // Mudou de propósito: conciliação e notas leem o banco novo; sem armazenamento a resposta é 503 (nunca "não executada" por engano).
    const conc = await chamar('GET', `/lilly/actions/${encodeURIComponent(longa)}`);
    assert.equal(conc.status, 503); assert.equal(conc.corpo.error.code, 'LILLY_STORAGE_UNAVAILABLE'); ok('reconciliação sem banco: 503 (o caso com banco está em verificar-gf-lilly-dados.js)');

    assert.equal((await chamar('GET', '/lilly/schedule-notes?tarologistId=9001')).status, 400);
    const notas = await chamar('GET', '/lilly/schedule-notes?tarologistId=9001&date=2026-11-07');
    assert.equal(notas.status, 503); ok('notas do horário: valida a forma; sem banco 503');

    assert.equal((await chamar('POST', '/lilly/context', { bruto: '{nao-e-json' })).status, 400); ok('JSON malformado: 400');
    assert.equal((await chamar('PUT', '/lilly/context', { corpo: {} })).status, 405); ok('método errado: 405');
  } finally { console.warn = muteLog; console.error = muteErr; }

  // idempotência
  const curta = normalizarChave('abc-12345:x:c1');
  assert.deepEqual(curta, { interna: 'abc-12345:x:c1', original: 'abc-12345:x:c1' });
  const longaN = normalizarChave(`evento-${'x'.repeat(300)}:s:c`);
  assert.match(longaN.interna, /^sha256:[0-9a-f]{64}$/); assert.equal(longaN.original.length > 128, true);
  assert.equal(normalizarChave('com espaço/barra').interna.startsWith('sha256:'), true);
  assert.equal(normalizarChave(''), null); assert.equal(normalizarChave(null), null); assert.equal(normalizarChave('x'.repeat(2000)), null);
  assert.equal(normalizarChave(`evento-${'x'.repeat(300)}:s:c`).interna, longaN.interna); ok('chave: original preservada, interna estável (hash se longa ou com símbolo), absurda recusada');
  const base = { kind: 'schedule', conversationId: 'c1', clientId: '9', tarologistId: 'afila', payload: { date: '2026-11-07', position: 'last' } };
  assert.equal(hashDaAcao(base), hashDaAcao({ ...base, status: 'sending', error: 'x', result: { id: 1 }, completionPending: true, sourceEventId: 'e' }));
  assert.equal(hashDaAcao(base), hashDaAcao({ payload: { position: 'last', date: '2026-11-07' }, tarologistId: 'afila', clientId: '9', conversationId: 'c1', kind: 'schedule' }));
  assert.notEqual(hashDaAcao(base), hashDaAcao({ ...base, payload: { ...base.payload, position: 'first' } }));
  assert.notEqual(hashDaAcao(base), hashDaAcao({ ...base, clientId: '10' })); ok('hash da ação: ignora status/erro/resultado, ordem das chaves e muda com o que importa');

  // status
  const t = traduzirStatusConsulta;
  assert.equal(t({ status: 'Em curso', awaitingTarologistStart: true }), 'prepared');
  assert.equal(t({ status: 'Em curso' }), 'in_progress'); assert.equal(t({ status: 'Concluída' }), 'completed');
  assert.equal(t({ status: 'Cancelada' }), 'cancelled'); assert.equal(t({ status: 'Finalizada pelo tarólogo' }), 'ended'); assert.equal(t({ status: 'Anulada' }), 'cancelled');
  assert.equal(t({ status: 'algo novo' }), 'unknown'); assert.equal(t(), 'unknown'); ok('status da consulta: tradução e desconhecido vira unknown');

  limpar(); servidor.close();
  console.log(`\n${n} verificações passaram.`);
})().catch((e) => { console.error('FALHOU:', e.message); limpar(); servidor.close(); process.exit(1); });
