'use strict';

/** Cadeia HTTP e validações sem conexão de banco: qualquer tentativa de SQL é contada e recusada. */
const assert = require('assert');
const { abrir, dados } = require('./ambiente');
const { passo, resumo } = require('../apoio-gf-banco-novo/comum');
const exigir = (r, status, codigo) => { assert.equal(r.status, status, r.t); assert.equal(r.j?.error?.code, codigo, r.t); };

(async () => {
  const a = await abrir({ offline: true });
  try {
    await passo('flag desligada recusa POST antes de sessão e banco', async () => {
      process.env.GF_FATIA_CADASTROS = 'false'; a.sessao('absent');
      try { exigir(await a.criar(dados()), 404, 'NOT_FOUND'); } finally { process.env.GF_FATIA_CADASTROS = 'true'; a.como(); }
    });
    await passo('método inválido declara GET e POST, preservando catálogo existente', async () => {
      const r = await a.chamar('DELETE', '/catalog/clients'); exigir(r, 405, 'METHOD_NOT_ALLOWED');
      assert.ok(r.headers.get('allow')?.includes('GET') && r.headers.get('allow')?.includes('POST'));
    });
    await passo('sessão ausente, inválida ou indisponível é recusada', async () => {
      for (const [s, codigo, erro] of [['absent', 401, 'SESSION_REQUIRED'], ['invalid', 401, 'SESSION_INVALID'], ['access-unavailable', 403, 'ACCOUNT_ACCESS_UNAVAILABLE']]) {
        a.sessao(s); exigir(await a.criar(dados()), codigo, erro);
      }
      a.como();
    });
    await passo('perfil de taróloga é recusado', async () => {
      a.como('tarologa'); try { exigir(await a.criar(dados()), 403, 'ACCESS_DENIED'); } finally { a.como(); }
    });
    await passo('origem ausente, externa ou cross-site é recusada', async () => {
      for (const h of [{ origin: null }, { origin: 'https://externa.invalid' }, { 'sec-fetch-site': 'cross-site' }]) exigir(await a.criar(dados(), a.chave(), h), 403, 'ORIGIN_NOT_ALLOWED');
    });
    await passo('origem configurada é respeitada', async () => {
      process.env.FADAS_ORIGIN = 'https://painel.invalid';
      try { exigir(await a.criar(dados()), 403, 'ORIGIN_NOT_ALLOWED'); } finally { delete process.env.FADAS_ORIGIN; }
    });
    await passo('corpo e chave inválidos não chegam ao banco', async () => {
      for (const body of [null, [], {}, { operationKey: 'curta', changes: dados() }]) exigir(await a.chamar('POST', '/catalog/clients', body), 400, 'INVALID_INPUT');
    });
    await passo('nome completo e telefone obrigatórios são validados', async () => {
      for (const changes of [{ phones: ['+55 11 98888-1111'] }, { fullName: 'Cliente' }, dados({ fullName: '' }), dados({ fullName: 123 }), dados({ phones: [] }), dados({ phones: ['123'] })]) exigir(await a.criar(changes), 422, 'RULE_VIOLATION');
    });
    await passo('formato de cadastro, Pré-pago e índices são validados antes da persistência', async () => {
      for (const extra of [{ name: 'n'.repeat(51) }, { birthDate: '31/02/1990' }, { birthDate: '1990-01-01' }, { email: 'invalido' }, { cpf: '11111111111' }, { noEmail: 'true' }, { consultationPhoneIndex: 2 }, { whatsappPhoneIndex: -1 }, { paymentProfile: 'Pós-pago' }]) exigir(await a.criar(dados(extra)), 422, 'RULE_VIOLATION');
    });
    await passo('nenhuma consulta SQL nem escrita legada ocorreu no roteiro offline', async () => {
      assert.equal(a.bancoOffline(), 0); assert.equal(a.chamadas.escritas, 0);
    });
  } finally { await a.fechar(); }
  const { ok, falhas } = resumo(); console.log(`\nCadastro manual offline: ${ok} ok, ${falhas.length} falhas`);
  process.exitCode = falhas.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 2; });
