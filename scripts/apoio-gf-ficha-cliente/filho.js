'use strict';

/**
 * FILHO de scripts/verificar-gf-ficha-cliente.js (Maturacao/32): roda contra o Postgres DESCARTÁVEL (fdb_cli_*) já migrado, com DB_* só no
 * ambiente deste processo. Prova pelo HTTP do gate o que a ficha real de Clientes usa: edição do cadastro por cada perfil, o nome editado
 * chegando ao saldo da cliente, restrições criadas e removidas pela equipe, leitura das consultas da cliente e a flag `clients` da sessão.
 * Legado MySQL substituído por listas fixas (nem é configurado).
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true',
  GF_FATIA_CONSULTA: 'true', GF_FATIA_CADASTROS: 'true', GF_FATIA_PAGAMENTOS: 'true', GF_FATIA_RESTRICOES: 'true', GF_FATIA_CLIENTES: 'true',
});
delete process.env.GF_LEGADO_ESCRITA_ENABLED;
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const ciclo = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.service'));
  const pagamentos = require(r('src/gestao-fadas/features/financeiro-cliente/pagamentos.service'));
  const restricoes = require(r('src/gestao-fadas/features/financeiro-cliente/restricoes.service'));
  const contexto = require(r('src/gestao-fadas/features/financeiro-cliente/fin.contexto'));
  const clientes = require(r('src/gestao-fadas/features/cadastros/clientes.service'));

  const PARTIDA = { 900013: 5000, 900014: -3000 };
  const EXISTE = new Set(Object.keys(PARTIDA));
  contexto.definirLeitorDePartida(async (ids) => new Map(ids.filter((id) => EXISTE.has(id)).map((id) => [id, { centavos: PARTIDA[id], conhecido: true, nome: `Cliente ${id}` }])));
  // Desde 31/10/2026 a abertura vem da PLANILHA (Maturacao/55): semeia o histórico (corte em 2000) com os mesmos valores. O leitor do legado fica só para existência e nome.
  await require('../apoio-gf-migracao/semear').semear(sequelize, Object.fromEntries(Object.entries(PARTIDA).filter(([, v]) => v !== 0)));
  const existe = async (id) => EXISTE.has(id);
  pagamentos.definirVerificadorDeCliente(existe); restricoes.definirVerificadorDeCliente(existe); ciclo.definirVerificadorDeCliente(existe); clientes.definirVerificadorDeCliente(existe);

  const u = { atendente: await criarUsuario('Atendente Ficha'), administradora: await criarUsuario('Administradora Ficha'), supervisora: await criarUsuario('Supervisora Ficha'), assistente: await criarUsuario('Assistente Ficha'), tarologa: await criarUsuario('Tarologa Ficha') };
  let sessao = { userId: u.atendente, role: 'atendente', displayName: 'Khloe' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-ficha' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 300) };
  };
  const como = (perfil, extra = {}) => { sessao = { userId: u[perfil], role: perfil, displayName: perfil === 'atendente' ? 'Khloe' : `Teste ${perfil}`, ...extra }; };
  const n = () => { n.i = (n.i || 0) + 1; return `op-${Date.now()}-${n.i}`; };
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);
  const editar = (id, revisao, mudancas, operationKey = n()) => chamar('PATCH', `/catalog/clients/${id}`, { operationKey, expectedRevision: revisao, changes: mudancas });

  console.log('Edição do cadastro pela ficha (cada perfil de equipe)');
  como('atendente');
  await passo('antes de editar: saldo traz o nome do legado e o Pré/Pós da planilha (Pré-pago)', async () => {
    const a = await chamar('GET', '/payments/accounts?ids=900013'); assert.equal(a.status, 200, a.t);
    assert.equal(a.j.accounts['900013'].name, 'Cliente 900013'); assert.equal(a.j.accounts['900013'].paymentProfile, 'Pré-pago');
    assert.equal(a.j.accounts['900013'].balanceCents, 5000);
  });
  await passo('atendente edita Pré/Pós, tratar por e WhatsApp (revisão 0 -> 1); resposta traz a extensão', async () => {
    const x = await editar('900013', 0, { paymentProfile: 'Pré-pago', treatAs: 'Má', whatsapp: '11 98888-7777' });
    assert.equal(x.status, 200, x.t); assert.equal(x.j.extension.revision, 1); assert.equal(x.j.extension.paymentProfile, 'Pré-pago'); assert.equal(x.j.extension.treatAs, 'Má');
  });
  await passo('supervisora, assistente e administradora também editam (cada uma com a revisão lida)', async () => {
    let rev = 1;
    for (const perfil of ['supervisora', 'assistente', 'administradora']) {
      como(perfil);
      const lida = (await chamar('GET', '/catalog/clients?ids=900013')).j.extensions['900013'].revision; assert.equal(lida, rev);
      const x = await editar('900013', lida, { treatAs: `Má ${perfil}`.slice(0, 30) }); assert.equal(x.status, 200, x.t); rev = x.j.extension.revision;
    }
    assert.equal(rev, 4);
  });
  await passo('nome e nascimento editados: o nome chega ao saldo da cliente (payments/accounts) e o Pré/Pós também; o legado não muda', async () => {
    como('atendente');
    const x = await editar('900013', 4, { name: 'Nome Editado', birthDate: '17/05/1990', paymentProfile: 'Pós-pago' }); assert.equal(x.status, 200, x.t);
    const a = await chamar('GET', '/payments/accounts?ids=900013');
    assert.equal(a.j.accounts['900013'].name, 'Nome Editado'); assert.equal(a.j.accounts['900013'].paymentProfile, 'Pós-pago'); assert.equal(a.j.accounts['900014'], undefined);
    const b = await chamar('GET', '/payments/accounts?ids=900014'); assert.equal(b.j.accounts['900014'].name, 'Cliente 900014');
  });
  await passo('revisão velha é 409 VERSION_CHANGED (a tela mostra a mensagem do gate); regra é 422; cliente inexistente 404; chave repetida devolve o mesmo resultado sem gravar', async () => {
    const velha = await editar('900013', 1, { treatAs: 'X' }); assert.equal(velha.status, 409); assert.equal(velha.j.error.code, 'VERSION_CHANGED'); assert.equal(velha.j.error.message, 'Este cadastro mudou. Feche e abra novamente para conferir.'); // texto do front (real-client-file-api.ts), Maturacao/35
    assert.equal((await editar('900013', 5, { birthDate: '31/02/2020' })).status, 422);
    assert.equal((await editar('900013', 5, { paymentProfile: 'Outro' })).status, 422);
    assert.equal((await editar('777777', 0, { treatAs: 'X' })).status, 404);
    const k = n(); const um = await editar('900014', 0, { treatAs: 'Bia' }, k); const dois = await editar('900014', 0, { treatAs: 'Bia' }, k);
    assert.equal(um.status, 200); assert.equal(dois.status, 200); assert.equal(dois.j.extension.revision, 1);
  });
  await passo('taróloga não edita cliente (403) nem lê extensões; nada foi gravado por ela; auditoria da edição existe', async () => {
    como('tarologa', { tarotId: '9001' });
    assert.equal((await editar('900013', 5, { treatAs: 'T' })).status, 403);
    assert.equal((await chamar('GET', '/catalog/clients?ids=900013')).status, 403);
    assert.ok(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'cadastros.cliente.editar'") >= 6);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_clientes_ext WHERE id_cliente = '900013'"), 1);
  });

  console.log('Restrições pela equipe (ficha real)');
  const R = (id, extra = {}) => ({ id, clientId: '900013', tarotId: '9001', requestedBy: 'client', reason: 'Cliente pediu', active: true, createdAt: '2000-01-01T00:00:00.000Z', createdBy: 'X', updatedAt: '2000-01-01T00:00:00.000Z', updatedBy: 'X', history: [{ action: 'created', at: '2000-01-01T00:00:00.000Z', actor: 'X', reason: 'Cliente pediu' }], ...extra });
  const gravar = (id, versao, registro) => chamar('PUT', `/restrictions/${id}`, { operationKey: n(), expectedVersion: versao, record: registro });
  await passo('atendente, supervisora e assistente criam restrição (autor e instante do servidor); a lista traz as três', async () => {
    const nomes = { atendente: 'Khloe', supervisora: 'Teste supervisora', assistente: 'Teste assistente' };
    let i = 0;
    for (const perfil of ['atendente', 'supervisora', 'assistente']) {
      como(perfil); i += 1;
      const x = await gravar(`ficha-${i}`, 0, R(`ficha-${i}`, { tarotId: `900${i}` })); assert.equal(x.status, 200, x.t);
      assert.equal(x.j.items[0].history[0].actor, nomes[perfil]); assert.notEqual(x.j.items[0].history[0].at, '2000-01-01T00:00:00.000Z');
    }
    assert.equal((await chamar('GET', '/restrictions')).j.items.length, 3);
  });
  await passo('taróloga não cria restrição (403) e a equipe remove (último evento "removed" vira inativa; versão velha é 409)', async () => {
    como('tarologa', { tarotId: '9001' });
    assert.equal((await gravar('ficha-9', 0, R('ficha-9'))).status, 403);
    como('atendente');
    const atual = (await chamar('GET', '/restrictions')).j.items.find((i) => i.id === 'ficha-1');
    const removida = { ...atual, history: [...atual.history, { action: 'removed', at: '2000-01-01T00:00:00.000Z', actor: 'X', reason: '' }] };
    assert.equal((await gravar('ficha-1', 5, removida)).status, 409);
    const ok = await gravar('ficha-1', 1, removida); assert.equal(ok.status, 200, ok.t); assert.equal(ok.j.items[0].active, false);
    assert.equal((await chamar('GET', '/restrictions')).j.items.filter((i) => i.active).length, 2);
  });

  console.log('Consultas da cliente e flag da sessão');
  await passo('GET /consultations aceita clientId e from (histórico inteiro da cliente); id inválido é 400; taróloga sem vínculo é 403', async () => {
    como('atendente');
    const a = await chamar('GET', '/consultations?clientId=900013&from=2000-01-01&includeClosed=true'); assert.equal(a.status, 200, a.t); assert.deepEqual(a.j.items, []);
    assert.equal((await chamar('GET', '/consultations?clientId=abc')).status, 400);
  });
  await passo('sessão nativa: realFeatures.clients só com GF_FATIA_CLIENTES', async () => {
    const { criarProvedorNativo } = require(r('src/gestao-fadas/gate/sessao-nativa'));
    const jwt = require('jsonwebtoken');
    const { ACCESS_COOKIE } = require(r('src/features/auth/auth.cookies.helper'));
    const { jwtVerifyOptions } = require(r('src/config/auth.config'));
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'segredo-de-teste-ficha-1234567890-abcdef';
    const servicos = { buscarUsuario: async () => ({ id: 'a-1', email: 'adm@x.test', role: 'GESTORA', is_active: true }), temSessaoViva: async () => true, carregarContexto: async () => ({ roleIds: ['admin'], staffProfile: null }), buscarTarotId: async () => null };
    const o = jwtVerifyOptions();
    const token = jwt.sign({ sub: 'a-1', token_use: 'access', account_type: 'user' }, process.env.JWT_SECRET, { expiresIn: '1h', ...(o.issuer ? { issuer: o.issuer } : {}), ...(o.audience ? { audience: o.audience } : {}) });
    const req = { headers: { cookie: `${ACCESS_COOKIE}=${token}` } };
    const lig = criarProvedorNativo({ servicos, env: { GF_FATIA_CLIENTES: 'true' } });
    assert.equal(JSON.parse((await lig.sessao(req)).corpo).realFeatures.clients, true);
    const desl = criarProvedorNativo({ servicos, env: {} });
    assert.ok(!('clients' in JSON.parse((await desl.sessao(req)).corpo).realFeatures));
  });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres descartável: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
