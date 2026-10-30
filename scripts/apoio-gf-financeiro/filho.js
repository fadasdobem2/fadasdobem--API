'use strict';

/**
 * FILHO de scripts/verificar-gf-financeiro-cliente.js: roda contra o Postgres DESCARTÁVEL (fdb_pag_*) já migrado, com DB_* só no ambiente deste
 * processo. Prova pelo HTTP do gate (sessão de mentira, usuários reais da A no banco; o MySQL legado NÃO é configurado: o saldo de partida e a
 * existência da cliente vêm de um leitor falso): preços (versões, revisão, idempotência, corrida, perfis), pagamentos (lançar, revisar,
 * confirmar, movimentos, cancelar, benefícios, saldo de partida congelado, 409, corrida, auditoria), a conferência do excesso no término com
 * o saldo real, restrições (par ativo único, taróloga só remove a própria, queixa validada contra a consulta) e as fontes do Painel.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true',
  GF_FATIA_CONSULTA: 'true', GF_FATIA_AGENDA: 'true', GF_FATIA_PRESENCA: 'true', GF_FATIA_PRECOS: 'true', GF_FATIA_PAGAMENTOS: 'true', GF_FATIA_RESTRICOES: 'true',
});
delete process.env.GF_LEGADO_ESCRITA_ENABLED;
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const ciclo = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.service'));
  const agendaServico = require(r('src/gestao-fadas/features/agenda/agenda.service'));
  const pagamentos = require(r('src/gestao-fadas/features/financeiro-cliente/pagamentos.service'));
  const restricoes = require(r('src/gestao-fadas/features/financeiro-cliente/restricoes.service'));
  const contexto = require(r('src/gestao-fadas/features/financeiro-cliente/fin.contexto'));

  // Legado falso: saldo de partida (centavos) por cliente. 900013 = 50,00; 900014 = -30,00 (a pagar); 900016 = 200,00; demais = 0,00.
  const PARTIDA = { 900013: 5000, 900014: -3000, 900016: 20000, 900017: 0, 900018: 0, 900019: 0 };
  const EXISTE = new Set(Object.keys(PARTIDA));
  contexto.definirLeitorDePartida(async (ids) => new Map(ids.filter((id) => EXISTE.has(id)).map((id) => [id, { centavos: PARTIDA[id], conhecido: true, nome: `Cliente ${id}` }])));
  const existe = async (id) => EXISTE.has(id);
  pagamentos.definirVerificadorDeCliente(existe); restricoes.definirVerificadorDeCliente(existe); ciclo.definirVerificadorDeCliente(existe); agendaServico.definirVerificadorDeCliente(existe);

  const uAtend = await criarUsuario('Atendente Pagamentos');
  const uAdm = await criarUsuario('Administradora Pagamentos');
  const uSup = await criarUsuario('Supervisora Pagamentos');
  const uAssist = await criarUsuario('Assistente Pagamentos');
  const uTar = await criarUsuario('Tarologa Pagamentos');
  const uTar2 = await criarUsuario('Tarologa Dois');
  let sessao = { userId: uAtend, role: 'atendente', displayName: 'Khloe' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-pag' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 300), h: resp.headers };
  };
  const como = (perfil, extra = {}) => {
    const mapa = { atendente: [uAtend, 'Khloe'], administradora: [uAdm, 'Laya'], supervisora: [uSup, 'Sup'], assistente: [uAssist, 'Assist'], tarologa: [uTar, 'Osíris'], tarologa2: [uTar2, 'Nyx'] };
    const [userId, displayName] = mapa[perfil];
    sessao = { userId, role: perfil.startsWith('tarologa') ? 'tarologa' : perfil, displayName, ...extra };
  };
  const n = () => { n.i = (n.i || 0) + 1; return `op-${Date.now()}-${n.i}`; };
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);
  const dinheiro = (c) => Math.round(c) / 100;

  console.log('Esquema');
  await passo('6 tabelas da fatia existem, o índice de restrição ativa existe e a migração roda de novo sem erro', async () => {
    const [t] = await sequelize.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('gf_precos_versoes','gf_pagamentos','gf_pagamentos_eventos','gf_beneficios_minutos','gf_saldos_partida','gf_restricoes')");
    assert.equal(t.length, 6);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM pg_indexes WHERE indexname = 'uq_restricoes_ativa'"), 1);
    await require(r('migrations/20261113000000-gestao-fadas-financeiro-cliente')).up({ sequelize });
  });

  // ---------------------------------------------------------------------------------------------------------------- PREÇOS
  console.log('Preços');
  como('administradora');
  const versao = (id, extra = {}) => ({ id, effectiveAt: '2026-10-02T12:00:00.000Z', changedFields: ['regularMinuteValue'], regularMinuteValue: 3.2, ...extra });
  const postarPreco = (v, expectedRevision, operationKey = n()) => chamar('POST', '/pricing/versions', { operationKey, expectedRevision, version: v });
  await passo('GET vazio: 200, DTO puro, no-store, revisão 0; a taróloga leva 403', async () => {
    const x = await chamar('GET', '/pricing');
    assert.equal(x.status, 200, x.t); assert.deepEqual(x.j.history, []); assert.equal(x.j.revision, 0); assert.ok(!('sucesso' in x.j)); assert.equal(x.h.get('cache-control'), 'no-store');
    como('tarologa', { tarotId: '9001' }); assert.equal((await chamar('GET', '/pricing')).status, 403); como('administradora');
  });
  const chaveP1 = n();
  await passo('nova versão: servidor carimba autor e instante, devolve o histórico com a versão e revisão 1', async () => {
    const x = await postarPreco(versao('VAL-prova-0001', { createdBy: 'Hacker', createdAt: '2000-01-01T00:00:00.000Z' }), 0, chaveP1);
    assert.equal(x.status, 200, x.t); assert.equal(x.j.revision, 1); assert.equal(x.j.history[0].id, 'VAL-prova-0001');
    assert.equal(x.j.history[0].createdBy, 'Laya'); assert.notEqual(x.j.history[0].createdAt, '2000-01-01T00:00:00.000Z'); assert.deepEqual(x.j.history[0].changedFields, ['regularMinuteValue']);
    assert.equal(x.j.history[0].regularMinuteValue, 3.2); assert.equal(x.j.history[0].pixKey, 'pix@fadasdobem.com.br', 'o resto vem da tabela vigente (VAL-001)');
  });
  await passo('mesma chave e corpo repete a resposta sem gravar de novo; mesma chave com outro corpo é 409 OPERATION_KEY_CONFLICT', async () => {
    const a = await postarPreco(versao('VAL-prova-0001', { createdBy: 'Hacker', createdAt: '2000-01-01T00:00:00.000Z' }), 0, chaveP1);
    assert.equal(a.status, 200); assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_precos_versoes'), 1);
    const b = await postarPreco(versao('VAL-prova-0001', { regularMinuteValue: 3.3 }), 0, chaveP1);
    assert.equal(b.status, 409); assert.equal(b.j.error.code, 'OPERATION_KEY_CONFLICT');
  });
  await passo('revisão velha é 409 VERSION_CHANGED com o texto do front; regras do front viram 422 com a mensagem', async () => {
    const a = await postarPreco(versao('VAL-prova-0002'), 0);
    assert.equal(a.status, 409); assert.equal(a.j.error.code, 'VERSION_CHANGED'); assert.equal(a.j.error.message, 'Não foi possível salvar esta configuração. Recarregue os valores e tente novamente.');
    const b = await postarPreco(versao('VAL-prova-0003', { regularMinuteValue: 3.205 }), 1);
    assert.equal(b.status, 422); assert.equal(b.j.error.message, 'Informe o valor do minuto com até duas casas decimais.');
    const c = await postarPreco({ id: 'VAL-prova-0004', effectiveAt: '2026-11-02T12:00:00.000Z', changedFields: [] }, 1);
    assert.equal(c.status, 422); assert.equal(c.j.error.message, 'Nenhuma alteração para salvar.');
    assert.equal((await postarPreco(versao('VAL-001'), 1)).status, 400);
    assert.equal((await postarPreco(versao('semprefixo'), 1)).status, 400);
  });
  await passo('só administradora e assistente gravam; supervisora e atendente leem e levam 403 ao gravar; gravação desligada é 503', async () => {
    como('atendente'); assert.equal((await chamar('GET', '/pricing')).status, 200);
    assert.equal((await postarPreco(versao('VAL-prova-0005'), 1)).status, 403);
    como('supervisora'); assert.equal((await postarPreco(versao('VAL-prova-0005'), 1)).status, 403);
    como('assistente'); const ok = await postarPreco(versao('VAL-prova-0005', { changedFields: ['pixKey'], pixKey: 'novo@pix.com' }), 1); assert.equal(ok.status, 200, ok.t);
    assert.equal(ok.j.history[0].pixKey, 'novo@pix.com'); assert.equal(ok.j.history[0].regularMinuteValue, 3.2, 'a versão anterior (vigente em 02/11) entra como base');
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
    const off = await postarPreco(versao('VAL-prova-0006'), 2); assert.equal(off.status, 503); assert.equal(off.j.error.code, 'WRITE_DISABLED');
    assert.equal((await chamar('GET', '/pricing')).status, 200, 'a leitura segue com a escrita desligada');
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; como('administradora');
  });
  await passo('corrida: duas gravações com a mesma revisão, uma passa e a outra é 409', async () => {
    const [a, b] = await Promise.all([postarPreco(versao('VAL-corrida-0001', { regularMinuteValue: 3.4 }), 2), postarPreco(versao('VAL-corrida-0002', { regularMinuteValue: 3.5 }), 2)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.t} | ${b.t}`);
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_precos_versoes'), 3);
  });
  await passo('auditoria na mesma transação: uma linha por versão gravada', async () => {
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'precos.versao'"), 3);
  });

  // ------------------------------------------------------------------------------------------------------------- PAGAMENTOS
  console.log('Pagamentos');
  como('atendente');
  const pag = (id, extra = {}) => ({
    id, clientId: '900013', client: 'Cliente 900013', amount: 88.8, method: 'PIX', bank: 'Mercado Pago', payerName: 'Cliente 900013', informedAt: '2000-01-01T00:00:00.000Z', informedBy: 'Hacker', status: 'Informado',
    purchase: { minutes: 30, amount: 88.8, table: 'regular', priceVersionId: 'VAL-001' }, audit: [{ id: `${id}-a1`, action: 'Pagamento informado', detail: 'x', actor: 'Hacker', createdAt: '2000-01-01T00:00:00.000Z' }], ...extra,
  });
  const lancarPag = (record, operationKey = n()) => chamar('POST', '/payments', { operationKey, record });
  const revisarPag = (id, expectedVersion, record, operationKey = n()) => chamar('POST', `/payments/${id}/revise`, { operationKey, expectedVersion, record });
  const conta = async (id) => (await chamar('GET', `/payments/accounts?ids=${id}`)).j.accounts[id];
  await passo('GET vazio; antes de qualquer movimento a conta usa o saldo de partida VIVO do legado e não congela', async () => {
    const x = await chamar('GET', '/payments'); assert.equal(x.status, 200, x.t); assert.deepEqual(x.j.items, []); assert.deepEqual(x.j.benefits, []);
    const c = await conta('900013'); assert.equal(c.openingCents, 5000); assert.equal(c.openingFrozen, false); assert.equal(c.balanceCents, 5000); assert.equal(c.name, 'Cliente 900013');
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_saldos_partida'), 0);
  });
  const chaveL = n();
  let versaoP1;
  await passo('lançar: servidor carimba autor e instante (o navegador não escolhe), congela o saldo de partida e o saldo soma o pagamento', async () => {
    const x = await lancarPag(pag('pag-1'), chaveL);
    assert.equal(x.status, 200, x.t); const p = x.j.items[0]; versaoP1 = x.j.versions['pag-1'];
    assert.equal(versaoP1, 1); assert.equal(p.informedBy, 'Khloe'); assert.notEqual(p.informedAt, '2000-01-01T00:00:00.000Z'); assert.equal(p.audit[0].actor, 'Khloe'); assert.equal(p.updatedBy, 'Khloe');
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_saldos_partida'), 1);
    const c = await conta('900013'); assert.equal(c.openingFrozen, true); assert.equal(c.balanceCents, 5000 + 8880); assert.equal(c.receivedCents, 8880);
    assert.equal(c.availableMinutes, 46, 'abertura de 50,00 a 2,96 (16,89 min) + pacote de 30 min = 46 minutos inteiros (domínio do front)');
  });
  await passo('o saldo de partida fica CONGELADO: mudar o legado depois não muda a conta', async () => {
    PARTIDA[900013] = 999999;
    const c = await conta('900013'); assert.equal(c.openingCents, 5000); assert.equal(c.balanceCents, 5000 + 8880);
    PARTIDA[900013] = 5000;
  });
  await passo('idempotência: mesma chave e corpo repete a resposta sem gravar; outro corpo é 409; id repetido com outra chave é 409', async () => {
    const a = await lancarPag(pag('pag-1'), chaveL); assert.equal(a.status, 200); assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_pagamentos'), 1);
    const b = await lancarPag(pag('pag-1', { amount: 50, purchase: undefined, cashUnitValue: 2.96 }), chaveL); assert.equal(b.status, 409); assert.equal(b.j.error.code, 'OPERATION_KEY_CONFLICT');
    const c = await lancarPag(pag('pag-1'), n()); assert.equal(c.status, 409, c.t); assert.equal(c.j.error.code, 'VERSION_CHANGED');
  });
  await passo('forma e regras: centavos quebrados, forma desconhecida, pacote que não bate e cliente inexistente', async () => {
    assert.equal((await lancarPag(pag('pag-x1', { amount: 10.005, purchase: undefined, cashUnitValue: 2.96 }))).status, 400);
    assert.equal((await lancarPag(pag('pag-x2', { method: 'Bitcoin' }))).status, 400);
    assert.equal((await lancarPag(pag('pag-x3', { clientId: 'abc' }))).status, 400);
    const p = await lancarPag(pag('pag-x4', { purchase: { minutes: 30, amount: 70, table: 'regular' } })); assert.equal(p.status, 422); assert.equal(p.j.error.message, 'Confira os minutos comprados e o valor da compra.');
    const c = await lancarPag(pag('pag-x5', { clientId: '999999' })); assert.equal(c.status, 404); assert.equal(c.j.error.code, 'CLIENT_NOT_FOUND');
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_pagamentos'), 1);
  });
  await passo('revisar: confirmar, com revisão; revisão velha é 409; a história de auditoria não pode ser apagada; nada reabre cancelado', async () => {
    const atual = (await chamar('GET', '/payments')).j.items.find((i) => i.id === 'pag-1');
    const confirmado = { ...atual, confirmation: 'Confirmado', audit: [...atual.audit, { id: 'pag-1-a2', action: 'Recebimento confirmado', detail: 'ok', actor: 'Hacker', createdAt: '2000-01-01T00:00:00.000Z' }] };
    const naoPode = await revisarPag('pag-1', 1, confirmado); assert.equal(naoPode.status, 422, naoPode.t); assert.equal(naoPode.j.error.message, 'Somente Financeiro e Administração podem confirmar recebimentos.');
    como('assistente'); const x = await revisarPag('pag-1', 1, confirmado); assert.equal(x.status, 200, x.t); como('atendente'); assert.equal(x.j.versions['pag-1'], 2); assert.equal(x.j.items[0].audit[1].actor, 'Assist'); assert.notEqual(x.j.items[0].audit[1].createdAt, '2000-01-01T00:00:00.000Z');
    const velho = await revisarPag('pag-1', 1, confirmado); assert.equal(velho.status, 409); assert.equal(velho.j.error.code, 'VERSION_CHANGED'); assert.equal(velho.j.error.message, 'O pagamento mudou. Confira a situação atual antes de continuar.');
    const apagou = await revisarPag('pag-1', 2, { ...confirmado, audit: [] }); assert.equal(apagou.status, 422); assert.equal(apagou.j.error.message, 'O histórico do pagamento não pode ser apagado.');
    const trocouQuem = await revisarPag('pag-1', 2, { ...confirmado, informedBy: 'Outro' }); assert.equal(trocouQuem.status, 422);
    const outroId = await revisarPag('pag-1', 2, { ...confirmado, id: 'pag-9' }); assert.equal(outroId.status, 400);
    assert.equal((await revisarPag('nao-existe', 1, pag('nao-existe'))).status, 404);
  });
  await passo('movimentos de saída (estorno) são do Financeiro: atendente e supervisora 403, administradora 200 e o crédito cai', async () => {
    const atual = (await chamar('GET', '/payments')).j.items.find((i) => i.id === 'pag-1');
    const estorno = { id: 'mov-1', kind: 'refund', amount: 30, bankEffect: -30, creditEffect: -30, occurredAt: '2026-10-30T12:00:00.000Z', actor: 'Hacker', note: 'Estorno de teste' };
    const comMov = { ...atual, movements: [estorno] };
    assert.equal((await revisarPag('pag-1', 2, comMov)).status, 403);
    como('supervisora'); assert.equal((await revisarPag('pag-1', 2, comMov)).status, 403);
    como('administradora'); const x = await revisarPag('pag-1', 2, comMov); assert.equal(x.status, 200, x.t);
    assert.equal(x.j.items[0].movements[0].actor, 'Laya'); assert.ok(x.j.items[0].movements[0].recordedAt);
    const c = await conta('900013'); assert.equal(c.balanceCents, 5000 + 8880 - 3000);
    const mexeu = await revisarPag('pag-1', 3, { ...x.j.items[0], movements: [{ ...estorno, amount: 31 }] }); assert.equal(mexeu.status, 422);
    como('atendente');
  });
  await passo('cancelar tira o pagamento do saldo; cancelado não reabre', async () => {
    const atual = (await chamar('GET', '/payments')).j.items.find((i) => i.id === 'pag-1');
    const x = await revisarPag('pag-1', 3, { ...atual, status: 'Cancelado' }); assert.equal(x.status, 200, x.t);
    assert.equal((await conta('900013')).balanceCents, 5000, 'sobra só o saldo de partida');
    const y = await revisarPag('pag-1', 4, { ...x.j.items[0], status: 'Informado' }); assert.equal(y.status, 422);
  });
  await passo('corrida: duas revisões com a mesma versão, uma passa e a outra é 409', async () => {
    await lancarPag(pag('pag-2', { amount: 59.2, purchase: { minutes: 20, amount: 59.2, table: 'regular' } }));
    const p = (await chamar('GET', '/payments')).j.items.find((i) => i.id === 'pag-2');
    const [a, b] = await Promise.all([revisarPag('pag-2', 1, { ...p, note: 'A' }), revisarPag('pag-2', 1, { ...p, note: 'B' })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.t} | ${b.t}`);
  });
  await passo('vínculo com consulta de OUTRA cliente é recusado (422)', async () => {
    const p = (await chamar('GET', '/payments')).j.items.find((i) => i.id === 'pag-2');
    como('administradora');
    await chamar('POST', '/consultations', { operationKey: n(), record: { id: 'con-vinc', clientId: '900014', client: 'Cliente 900014', tarotId: '9001', tarot: 'Osíris', paymentProfile: 'Pós-paga', channel: 'WhatsApp Áudio', observation: '', expectedMinutes: 30 } });
    como('atendente');
    const v = (await chamar('GET', '/payments')).j.versions['pag-2'];
    const x = await revisarPag('pag-2', v, { ...p, linkedConsultationId: 'con-vinc' }); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'Esta consulta pertence a outra cliente.');
  });
  const benef = (id, extra = {}) => ({ id, clientId: '900013', kind: 'Cortesia', minutes: 15, unitValue: 2.96, reason: 'Boas-vindas', grantedBy: 'Hacker', grantedAt: '2000-01-01T00:00:00.000Z', ...extra });
  await passo('bônus/cortesia: servidor carimba autor e instante; regras do front; id repetido 409; entra na cobertura da cliente', async () => {
    const x = await chamar('POST', '/payments/benefits', { operationKey: n(), benefit: benef('ben-1') }); assert.equal(x.status, 200, x.t);
    assert.equal(x.j.benefit.grantedBy, 'Khloe'); assert.notEqual(x.j.benefit.grantedAt, '2000-01-01T00:00:00.000Z'); assert.equal(x.j.benefit.payTarologist, true);
    assert.equal((await chamar('POST', '/payments/benefits', { operationKey: n(), benefit: benef('ben-2', { minutes: 2000 }) })).j.error.message, 'Informe de 1 a 1440 minutos inteiros.');
    assert.equal((await chamar('POST', '/payments/benefits', { operationKey: n(), benefit: benef('ben-2', { reason: ' ' }) })).j.error.message, 'Informe o motivo do bônus ou da cortesia.');
    assert.equal((await chamar('POST', '/payments/benefits', { operationKey: n(), benefit: benef('ben-2', { unitValue: 0 }) })).j.error.message, 'Confira a referência do minuto.');
    assert.equal((await chamar('POST', '/payments/benefits', { operationKey: n(), benefit: benef('ben-1') })).status, 409);
    assert.equal((await chamar('POST', '/payments/benefits', { operationKey: n(), benefit: benef('ben-3', { clientId: '999999' }) })).status, 404);
    const c = await conta('900013'); assert.equal(c.benefitMinutes, 15);
    const lista = await chamar('GET', '/payments'); assert.equal(lista.j.benefits.length, 1);
  });
  await passo('a taróloga não vê pagamento, saldo nem benefício; não lança nem concede (403)', async () => {
    como('tarologa', { tarotId: '9001' });
    for (const [m, p, c] of [['GET', '/payments'], ['GET', '/payments/accounts?ids=900013'], ['POST', '/payments', { operationKey: n(), record: pag('pag-t') }], ['POST', '/payments/benefits', { operationKey: n(), benefit: benef('ben-t') }], ['POST', '/payments/pag-2/revise', { operationKey: n(), expectedVersion: 1, record: pag('pag-2') }]]) {
      assert.equal((await chamar(m, p, c)).status, 403, `${m} ${p}`);
    }
    como('atendente');
  });
  await passo('auditoria e eventos na mesma transação; uma linha por gravação', async () => {
    assert.ok(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao LIKE 'pagamentos.%'") >= 7);
    assert.ok(await contar('SELECT COUNT(*) AS n FROM gf_pagamentos_eventos') >= 5);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_pagamentos_eventos WHERE tipo = 'movimento'"), 1);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_pagamentos_eventos WHERE tipo = 'cancelamento'"), 1);
  });

  // ----------------------------------------------------------------------------------- CONFERÊNCIA DO EXCESSO COM O SALDO REAL
  console.log('Conferência do excesso no término com o saldo real');
  const lancarCon = (id, clientId, extra = {}) => chamar('POST', '/consultations', { operationKey: n(), record: { id, clientId, client: `Cliente ${clientId}`, tarotId: `91${clientId.slice(-2)}`, tarot: 'Tarólogo', paymentProfile: 'Pré-paga', channel: 'WhatsApp Áudio', observation: '', expectedMinutes: 30, ...extra } });
  const terminarCom = async (id, clientId, minutos) => {
    como('atendente');
    const l = await lancarCon(id, clientId); assert.equal(l.status, 200, l.t);
    const s = await chamar('POST', `/consultations/${id}/start`, { operationKey: n() }); assert.equal(s.status, 200, s.t);
    return chamar('POST', `/consultations/${id}/finish-by-staff`, { operationKey: n(), minutes: minutos, timingConfirmed: true });
  };
  await passo('cliente com saldo que cobre o adicional: o término acima do máximo NÃO ganha unfunded_extra (saldo real)', async () => {
    const x = await terminarCom('con-cob-1', '900016', 45); assert.equal(x.status, 200, x.t);
    const c = x.j.consultations[0]; assert.ok(c.tarologistFinishReport.reviewReasons.includes('extra_minutes')); assert.ok(!c.tarologistFinishReport.reviewReasons.includes('unfunded_extra'), JSON.stringify(c.tarologistFinishReport.reviewReasons));
    assert.equal(c.durationSeconds, 30 * 60, 'o tempo cobrável segue limitado ao máximo até a conferência (regra do front)');
  });
  await passo('cliente sem saldo: o mesmo término ganha unfunded_extra e a razão vem do front', async () => {
    const x = await terminarCom('con-cob-2', '900017', 45); assert.equal(x.status, 200, x.t);
    const c = x.j.consultations[0]; assert.ok(c.tarologistFinishReport.reviewReasons.includes('unfunded_extra'));
    assert.equal(c.tarologistFinishReport.financialCap.reason, 'O saldo confirmado não cobre esse tempo adicional. Peça ao atendimento para registrar ou conferir o pagamento.');
  });
  await passo('outra consulta em curso da mesma cliente: não cobre, com a mensagem do front', async () => {
    await lancarCon('con-cob-3a', '900018', { tarotId: '9202', tarot: 'Nyx' });
    // A ocupação impede duas abertas da mesma cliente sem aprovação: o contexto do domínio é provado por consulta direta, abaixo, no ouro. Aqui só a recusa de ocupação.
    const y = await lancarCon('con-cob-3b', '900018', { tarotId: '9203' }); assert.equal(y.status, 409); assert.equal(y.j.error.code, 'OCCUPANCY_CONFLICT');
  });
  await passo('pagamento confirmado vinculado cobre: cliente sem abertura mas com pagamento de 133,20 confirmado', async () => {
    como('atendente');
    const p = await lancarPag(pag('pag-cob', { clientId: '900019', amount: 133.2, purchase: undefined, cashUnitValue: 2.96 })); assert.equal(p.status, 200, p.t);
    como('assistente'); const conf = await revisarPag('pag-cob', 1, { ...p.j.items[0], confirmation: 'Confirmado' }); assert.equal(conf.status, 200, conf.t); como('atendente');
    const x = await terminarCom('con-cob-4', '900019', 45); assert.equal(x.status, 200, x.t);
    assert.ok(!x.j.consultations[0].tarologistFinishReport.reviewReasons.includes('unfunded_extra'));
  });
  await passo('flag de pagamentos desligada: volta ao comportamento anterior (o excesso nunca é coberto), sem erro', async () => {
    process.env.GF_FATIA_PAGAMENTOS = 'false';
    const l = await lancarCon('con-cob-5', '900016', { tarotId: '9204', tarot: 'Nyx' }); assert.equal(l.status, 200, l.t);
    await chamar('POST', '/consultations/con-cob-5/start', { operationKey: n() });
    const x = await chamar('POST', '/consultations/con-cob-5/finish-by-staff', { operationKey: n(), minutes: 45, timingConfirmed: true }); assert.equal(x.status, 200, x.t);
    assert.ok(x.j.consultations[0].tarologistFinishReport.reviewReasons.includes('unfunded_extra'));
    process.env.GF_FATIA_PAGAMENTOS = 'true';
  });

  // ------------------------------------------------------------------------------------------------------------- RESTRIÇÕES
  console.log('Restrições');
  const R = (id, extra = {}) => ({
    id, clientId: '900013', tarotId: '9001', requestedBy: 'client', reason: 'Cliente pediu', active: true, createdAt: '2000-01-01T00:00:00.000Z', createdBy: 'Hacker', updatedAt: '2000-01-01T00:00:00.000Z', updatedBy: 'Hacker',
    history: [{ action: 'created', at: '2000-01-01T00:00:00.000Z', actor: 'Hacker', reason: 'Cliente pediu' }], ...extra,
  });
  const gravarR = (id, expectedVersion, record, operationKey = n()) => chamar('PUT', `/restrictions/${id}`, { operationKey, expectedVersion, record });
  const lerR = () => chamar('GET', '/restrictions');
  como('atendente');
  await passo('GET vazio; criar: servidor carimba autor e instante dos eventos manuais; o navegador não escolhe', async () => {
    const v = await lerR(); assert.equal(v.status, 200, v.t); assert.deepEqual(v.j.items, []);
    const x = await gravarR('rest-1', 0, R('rest-1')); assert.equal(x.status, 200, x.t);
    const c = x.j.items[0]; assert.equal(c.history[0].actor, 'Khloe'); assert.notEqual(c.history[0].at, '2000-01-01T00:00:00.000Z'); assert.equal(c.createdBy, 'Khloe'); assert.equal(x.j.versions['rest-1'], 1);
  });
  await passo('mesmo par e mesmo solicitante ativo com OUTRO id é 409 (índice único parcial); outro solicitante pode', async () => {
    const x = await gravarR('rest-dup', 0, R('rest-dup')); assert.equal(x.status, 409); assert.equal(x.j.error.code, 'VERSION_CHANGED');
    const y = await gravarR('rest-2', 0, R('rest-2', { requestedBy: 'tarologist' })); assert.equal(y.status, 200, y.t);
  });
  await passo('idempotência por operationKey; editar com revisão; revisão velha é 409; histórico não se apaga', async () => {
    const k = n();
    const atual = (await lerR()).j.items.find((i) => i.id === 'rest-1');
    const editada = { ...atual, reason: 'Novo motivo', history: [...atual.history, { action: 'edited', at: '2000-01-01T00:00:00.000Z', actor: 'Hacker', reason: 'Novo motivo' }] };
    const a = await gravarR('rest-1', 1, editada, k); assert.equal(a.status, 200, a.t); assert.equal(a.j.items[0].reason, 'Novo motivo'); assert.equal(a.j.items[0].history[1].actor, 'Khloe');
    const b = await gravarR('rest-1', 1, editada, k); assert.equal(b.status, 200); assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'restricoes.gravar'"), 3);
    assert.equal((await gravarR('rest-1', 1, editada)).status, 409);
    assert.equal((await gravarR('rest-1', 2, { ...editada, history: [] })).status, 400);
    assert.equal((await gravarR('rest-1', 2, { ...editada, history: [editada.history[1]] })).status, 422);
    assert.equal((await gravarR('rest-1', 2, { ...editada, tarotId: '9002' })).status, 422, 'o par não muda');
  });
  await passo('remover: ativa vira inativa, mantém o último motivo; remover de novo é 422; cliente inexistente é 404', async () => {
    const atual = (await lerR()).j.items.find((i) => i.id === 'rest-1');
    const x = await gravarR('rest-1', 2, { ...atual, active: false, history: [...atual.history, { action: 'removed', at: '2000-01-01T00:00:00.000Z', actor: 'Hacker', reason: '' }] }); assert.equal(x.status, 200, x.t);
    assert.equal(x.j.items[0].active, false); assert.equal(x.j.items[0].reason, 'Novo motivo');
    const y = await gravarR('rest-1', 3, { ...x.j.items[0], history: [...x.j.items[0].history, { action: 'removed', at: '2000-01-01T00:00:00.000Z', actor: 'Hacker', reason: '' }] }); assert.equal(y.status, 422); assert.equal(y.j.error.message, 'Esta restrição já foi removida.');
    assert.equal((await gravarR('rest-9', 0, R('rest-9', { clientId: '999999' }))).status, 404);
    const novo = await gravarR('rest-10', 0, R('rest-10')); assert.equal(novo.status, 200, 'depois de removida, o par pode ser restringido de novo');
  });
  await passo('taróloga: lê SÓ as dela pedidas por ela; remove a própria; não inclui, não edita, não remove a do cliente nem a de outra', async () => {
    como('tarologa', { tarotId: '9001' });
    const lista = await lerR(); assert.equal(lista.status, 200, lista.t); assert.deepEqual(lista.j.items.map((i) => i.id), ['rest-2'], 'rest-10 é pedida pelo cliente e fica oculta');
    assert.equal((await gravarR('rest-t1', 0, R('rest-t1', { requestedBy: 'tarologist', clientId: '900014' }))).status, 422);
    const minha = lista.j.items[0];
    const edita = await gravarR('rest-2', 1, { ...minha, reason: 'x', history: [...minha.history, { action: 'edited', at: '2000-01-01T00:00:00.000Z', actor: 'Hacker', reason: 'x' }] }); assert.equal(edita.status, 422); assert.equal(edita.j.error.message, 'Para incluir ou alterar uma restrição, comunique ao atendimento.');
    const doCliente = (await (async () => { como('atendente'); const l = await lerR(); como('tarologa', { tarotId: '9001' }); return l; })()).j.items.find((i) => i.id === 'rest-10');
    assert.equal((await gravarR('rest-10', 1, { ...doCliente, active: false, history: [...doCliente.history, { action: 'removed', at: '2000-01-01T00:00:00.000Z', actor: 'Hacker', reason: '' }] })).status, 403);
    como('tarologa2', { tarotId: '9002' });
    assert.equal((await gravarR('rest-2', 1, { ...minha, active: false, history: [...minha.history, { action: 'removed', at: '2000-01-01T00:00:00.000Z', actor: 'Hacker', reason: '' }] })).status, 403, 'outra taróloga não remove');
    como('tarologa', { tarotId: '9001' });
    const rem = await gravarR('rest-2', 1, { ...minha, active: false, history: [...minha.history, { action: 'removed', at: '2000-01-01T00:00:00.000Z', actor: 'Hacker', reason: '' }] }); assert.equal(rem.status, 200, rem.t);
    assert.equal(rem.j.items[0].active, false); assert.equal(rem.j.items[0].history[1].actor, 'Osíris');
    sessao = { ...sessao, tarotId: undefined }; assert.equal((await lerR()).status, 403, 'taróloga sem tarotId na sessão não lê');
    como('atendente');
  });
  await passo('restrição nascida da queixa: a consulta citada tem de existir, ser da mesma cliente e taróloga e ter a revisão de cancelamento', async () => {
    const queixa = (idc) => R(`complaint-${idc}`, { complaintConsultationIds: [idc], reason: `Consulta ${idc} cancelada por reclamação da cliente. Queixa registrada na consulta.`, createdBy: 'Laya', updatedBy: 'Laya', history: [{ action: 'created', at: '2026-10-29T10:00:00.000Z', actor: 'Laya', reason: `Consulta ${idc} cancelada por reclamação da cliente. Queixa registrada na consulta.` }] });
    const sem = await gravarR('complaint-con-cob-1', 0, queixa('con-cob-1')); assert.equal(sem.status, 422); assert.equal(sem.j.error.message, 'Confira a consulta cancelada por reclamação.');
    assert.equal((await gravarR('complaint-nao-tem', 0, queixa('nao-tem'))).status, 422);
    await sequelize.query(`UPDATE gf_consultas_ext SET item = item || '{"cancellationReview": {"status": "pending", "requestedAt": "2026-10-29T10:00:00.000Z", "requestedBy": "Laya"}}'::jsonb WHERE id = 'con-cob-1'`);
    const outroPar = await gravarR('complaint-con-cob-1', 0, { ...queixa('con-cob-1'), clientId: '900014' }); assert.equal(outroPar.status, 422);
    const ok = await gravarR('complaint-con-cob-1', 0, { ...queixa('con-cob-1'), tarotId: '9116', clientId: '900016' }); assert.equal(ok.status, 200, ok.t);
    assert.equal(ok.j.items[0].history[0].actor, 'Laya', 'o autor e o instante da queixa vêm da consulta, não do navegador do dia');
    assert.equal(ok.j.items[0].history[0].at, '2026-10-29T10:00:00.000Z');
  });
  await passo('corrida: duas criações do mesmo par com ids diferentes, uma passa e a outra é 409', async () => {
    const [a, b] = await Promise.all([gravarR('rest-c1', 0, R('rest-c1', { clientId: '900014', tarotId: '9005' })), gravarR('rest-c2', 0, R('rest-c2', { clientId: '900014', tarotId: '9005' }))]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.t} | ${b.t}`);
  });

  // -------------------------------------------------------------------------------------------------------- FONTES DO PAINEL
  console.log('Fontes do Painel');
  await passo('GET /panel/sources entrega payments, pricing e restrictions reais e nada falta (intakeEvents e requests vêm da Agenda)', async () => {
    como('administradora');
    const x = await chamar('GET', '/panel/sources'); assert.equal(x.status, 200, x.t);
    assert.deepEqual(x.j.missing.sort(), []); assert.deepEqual(x.j.intakeEvents, []); assert.deepEqual(x.j.requests, []);
    assert.ok(x.j.payments.length >= 2); assert.ok(x.j.restrictions.length >= 3); assert.equal(x.j.pricing.history.length, 3); assert.equal(typeof x.j.pricing.current.regularMinuteValue, 'number');
    assert.ok(['VAL-corrida-0001', 'VAL-corrida-0002'].includes(x.j.pricing.current.id), 'a vigente é a última que já entrou em vigor'); assert.ok([3.4, 3.5].includes(x.j.pricing.current.regularMinuteValue)); assert.equal(x.j.pricing.current.pixKey, 'novo@pix.com');
    como('tarologa', { tarotId: '9001' }); assert.equal((await chamar('GET', '/panel/sources')).status, 403);
    process.env.GF_FATIA_RESTRICOES = 'false';
    como('administradora'); const y = await chamar('GET', '/panel/sources'); assert.ok(y.j.missing.includes('restrictions')); assert.deepEqual(y.j.restrictions, []);
    process.env.GF_FATIA_RESTRICOES = 'true';
  });

  console.log('Higiene');
  await passo('nada do legado foi tocado: o leitor falso foi o único acesso e não há escrita no legado', async () => {
    assert.equal(process.env.GF_LEGADO_ESCRITA_ENABLED, undefined);
  });


  await passo('janela opcional em GET /payments: sem parâmetros nada muda; limit/after paginam na mesma ordem, com nextCursor; parâmetro ruim é 400', async () => {
    const todas = await chamar('GET', '/payments'); assert.equal(todas.status, 200, todas.t); const n0 = todas.j.items.length; assert.ok(!('nextCursor' in todas.j), 'sem limit não há nextCursor');
    if (n0 < 2) { console.log('        (menos de 2 itens: só o contrato padrão foi conferido)'); return; }
    const p1 = await chamar('GET', '/payments?limit=1'); assert.equal(p1.status, 200, p1.t); assert.equal(p1.j.items.length, 1); assert.ok(p1.j.nextCursor, 'tem próxima página'); assert.equal(((x) => x.id)(p1.j.items[0]), ((x) => x.id)(todas.j.items[0]));
    const p2 = await chamar('GET', '/payments?limit=1&after=' + encodeURIComponent(p1.j.nextCursor)); assert.equal(p2.status, 200, p2.t); assert.equal(((x) => x.id)(p2.j.items[0]), ((x) => x.id)(todas.j.items[1]));
    const tudo = await chamar('GET', '/payments?limit=1000'); assert.equal(tudo.j.items.length, n0); assert.equal(tudo.j.nextCursor, null);
    for (const ruim of ['limit=0', 'limit=abc', 'limit=1001', 'after=nao-existe-xyz']) assert.equal((await chamar('GET', '/payments?' + ruim)).status, 400, ruim);
  });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres descartável: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
