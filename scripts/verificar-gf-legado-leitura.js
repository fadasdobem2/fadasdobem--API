#!/usr/bin/env node
'use strict';

/**
 * Leitura do legado: falha de CONEXÃO repete uma vez (o servidor compartilhado recusa a reabertura depois de ociosidade);
 * erro de consulta e tempo esgotado de consulta NÃO repetem; esgotando a repetição vira 503 LEGADO_INDISPONIVEL.
 * Sem banco: `lendo` recebe uma função falsa. Nada é aberto nem escrito.
 */
const assert = require('node:assert/strict');
Object.assign(process.env, { LEGADO_DB_HOST: '127.0.0.1', LEGADO_DB_NAME: 'falso', LEGADO_DB_USER: 'falso', LEGADO_DB_PASSWORD: 'falso' });
const { lendo } = require('../src/gestao-fadas/_comum/legado');

const silencio = console.warn; console.warn = () => {};
const erro = (name, code) => Object.assign(new Error(name), { name, ...(code ? { code } : {}) });
let ok = 0;
const caso = async (nome, fn) => { await fn(); ok += 1; silencio(`  ok  ${nome}`); };

(async () => {
  await caso('falha de conexão na 1a tentativa e sucesso na 2a: devolve o resultado, 2 chamadas', async () => {
    let n = 0;
    const r = await lendo(async () => { n += 1; if (n === 1) throw erro('SequelizeConnectionError', 'ECONNRESET'); return 'dados'; });
    assert.equal(r, 'dados'); assert.equal(n, 2);
  });
  await caso('código de rede cru (ETIMEDOUT) também repete uma vez', async () => {
    let n = 0;
    const r = await lendo(async () => { n += 1; if (n === 1) throw erro('Error', 'ETIMEDOUT'); return 7; });
    assert.equal(r, 7); assert.equal(n, 2);
  });
  await caso('falha de conexão nas duas tentativas: 503 LEGADO_INDISPONIVEL, só 2 chamadas', async () => {
    let n = 0;
    await assert.rejects(lendo(async () => { n += 1; throw erro('SequelizeConnectionRefusedError', 'ECONNREFUSED'); }), (e) => e.statusCode === 503);
    assert.equal(n, 2);
  });
  await caso('erro de consulta (SequelizeDatabaseError) NÃO repete', async () => {
    let n = 0;
    await assert.rejects(lendo(async () => { n += 1; throw erro('SequelizeDatabaseError'); }), (e) => e.statusCode === 503);
    assert.equal(n, 1);
  });
  await caso('tempo esgotado de consulta (SequelizeTimeoutError) NÃO repete', async () => {
    let n = 0;
    await assert.rejects(lendo(async () => { n += 1; throw erro('SequelizeTimeoutError'); }), (e) => e.statusCode === 503);
    assert.equal(n, 1);
  });
  await caso('erro de programação (TypeError) passa como veio, sem repetir', async () => {
    let n = 0;
    await assert.rejects(lendo(async () => { n += 1; throw new TypeError('bug'); }), TypeError);
    assert.equal(n, 1);
  });
  console.warn = silencio;
  console.log(`verificar-gf-legado-leitura: ${ok} casos ok`);
  process.exit(0);
})().catch((e) => { console.warn = silencio; console.error(e); process.exit(1); });
