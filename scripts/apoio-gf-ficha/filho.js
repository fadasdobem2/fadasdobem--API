'use strict';

/**
 * FILHO de scripts/verificar-gf-ficha.js: roda contra o Postgres DESCARTÁVEL (fdb_fch_*) já migrado, com DB_* só no ambiente deste processo.
 * Prova pelo HTTP do gate (sessão de mentira, usuários reais da A no banco; o MySQL legado NÃO é configurado: a conferência da cliente é trocada
 * por uma lista de ids de mentira): orientação financeira (leitura, quem decide, carimbo do servidor, 409, idempotência, corrida, auditoria) e
 * observações (criar, editar com histórico, formatação, versão), perfis, escrita desligada. Busca e histórico: ver `filho-busca.js`.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_FICHA: 'true',
});
delete process.env.GF_LEGADO_ESCRITA_ENABLED;
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const { definirVerificadorDeCliente } = require(r('src/gestao-fadas/features/ficha/ficha.comum'));
  const CLIENTES = new Set(['900013', '900014', '900015']);
  definirVerificadorDeCliente(async (id) => CLIENTES.has(id));
  const u = { atend: await criarUsuario('Atendente Fch'), adm: await criarUsuario('Administradora Fch'), sup: await criarUsuario('Supervisora Fch'), assist: await criarUsuario('Assistente Fch'), tar: await criarUsuario('Tarologa Fch') };
  let sessao = { userId: u.atend, role: 'atendente', displayName: 'Khloe' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-fch' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 300), h: resp.headers };
  };
  const como = (perfil) => {
    const mapa = { atendente: [u.atend, 'Khloe'], administradora: [u.adm, 'Laya'], supervisora: [u.sup, 'Clara'], assistente: [u.assist, 'Assist'], tarologa: [u.tar, 'Osíris'] };
    const [userId, displayName] = mapa[perfil];
    sessao = { userId, role: perfil, displayName, ...(perfil === 'tarologa' ? { tarotId: '9001' } : {}) };
  };
  const n = () => { n.i = (n.i || 0) + 1; return `op-fch-${Date.now()}-${n.i}`; };
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);
  const evento = (id, action, reason, role = 'atendente') => ({ id, action, reason, at: '2000-01-01T00:00:00.000Z', by: 'Hacker', role });
  const guia = (hist, extra = {}) => ({ revision: hist.length, active: true, requiresApproval: true, pendingReview: true, reason: hist[hist.length - 1].reason, at: '2000-01-01T00:00:00.000Z', by: 'Hacker', history: hist, ...extra });
  const orientar = (clientId, record, expectedVersion, operationKey = n()) => chamar('PUT', '/client-guidance', { operationKey, expectedVersion, clientId, record });
  const lerOr = () => chamar('GET', '/client-guidance');
  const nota = (id, clientId, text, extra = {}) => ({ id, clientId, text, ...extra });
  const gravarNota = (record, expectedVersion, operationKey = n()) => chamar('PUT', '/client-notes', { operationKey, expectedVersion, record });

  console.log('Esquema');
  await passo('as tabelas existem, têm os CHECKs e a migração roda de novo sem erro', async () => {
    assert.equal(await contar("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_name IN ('gf_clientes_orientacoes', 'gf_clientes_notas')"), 2);
    assert.ok(await contar("SELECT COUNT(*) AS n FROM pg_constraint WHERE conname LIKE 'chk_orientacoes_%' OR conname LIKE 'chk_notas_%'") >= 10);
    await require(r('migrations/20261121000000-gestao-fadas-ficha-cliente')).up({ sequelize });
    await assert.rejects(() => sequelize.query("INSERT INTO gf_clientes_orientacoes (id_cliente, ativa, pendente, item, atualizado_por, operation_key) VALUES ('0x', true, true, '{}', 'a', 'op-xxxxxxxx')"));
    await assert.rejects(() => sequelize.query("INSERT INTO gf_clientes_notas (id, id_cliente, item, criado_por, operation_key) VALUES ('n', '900013', '[]', 'a', 'op-xxxxxxxx')"));
  });

  console.log('Orientação financeira: leitura e perfis');
  await passo('GET vazio: 200, DTO puro, no-store; a taróloga é recusada (403) na leitura e na gravação', async () => {
    como('atendente');
    const x = await lerOr(); assert.equal(x.status, 200, x.t); assert.deepEqual(x.j.items, []); assert.deepEqual(x.j.versions, {}); assert.ok(!('sucesso' in x.j)); assert.equal(x.h.get('cache-control'), 'no-store');
    como('tarologa');
    assert.equal((await lerOr()).status, 403);
    assert.equal((await orientar('900013', guia([evento('e1', 'request', 'x')]), 0)).status, 403);
    assert.equal((await chamar('GET', '/client-notes')).status, 403);
    como('atendente');
  });

  console.log('Orientação financeira: encaminhar, decidir');
  const chaveReq = n();
  await passo('a atendente passa à supervisora: o servidor carimba autor, papel e instante (não o do navegador) e devolve a revisão 1', async () => {
    const x = await orientar('900013', guia([evento('e1', 'request', '  Cliente com saldo negativo.  ')]), 0, chaveReq);
    assert.equal(x.status, 200, x.t); assert.equal(x.j.versions['900013'], 1);
    const g = x.j.items[0].guidance; assert.equal(x.j.items[0].clientId, '900013');
    assert.equal(g.by, 'Khloe'); assert.equal(g.history[0].by, 'Khloe'); assert.equal(g.history[0].role, 'atendente'); assert.notEqual(g.at, '2000-01-01T00:00:00.000Z'); assert.equal(g.reason, 'Cliente com saldo negativo.');
    assert.equal(g.pendingReview, true); assert.equal(g.requiresApproval, true); assert.equal(g.active, true);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_clientes_orientacoes WHERE ativa AND pendente"), 1);
  });
  await passo('mesma chave e corpo repete a resposta sem gravar de novo; mesma chave com outro corpo é 409 OPERATION_KEY_CONFLICT', async () => {
    const x = await orientar('900013', guia([evento('e1', 'request', '  Cliente com saldo negativo.  ')]), 0, chaveReq); assert.equal(x.status, 200, x.t); assert.equal(x.j.versions['900013'], 1);
    const y = await orientar('900013', guia([evento('e1', 'request', 'Outro texto.')]), 0, chaveReq); assert.equal(y.status, 409); assert.equal(y.j.error.code, 'OPERATION_KEY_CONFLICT');
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_clientes_orientacoes'), 1);
  });
  await passo('versão velha: 409 VERSION_CHANGED com o texto da tela, nada muda', async () => {
    const x = await orientar('900013', guia([evento('e1b', 'request', 'Outra vez.')]), 0); assert.equal(x.status, 409); assert.equal(x.j.error.code, 'VERSION_CHANGED'); assert.match(x.j.error.message, /A orientação desta cliente mudou/);
  });
  await passo('todos da equipe leem; a atendente não decide (422 com a mensagem do front)', async () => {
    for (const p of ['supervisora', 'administradora', 'assistente', 'atendente']) { como(p); const x = await lerOr(); assert.equal(x.j.items.length, 1, p); assert.equal(x.j.versions['900013'], 1); }
    como('atendente'); const atual = (await lerOr()).j.items[0].guidance;
    const y = await orientar('900013', guia([...atual.history, evento('e2', 'release', 'Liberada.')]), 1); assert.equal(y.status, 422, y.t); assert.match(y.j.error.message, /precisa ser decidida pela supervisora/);
  });
  await passo('a supervisora autoriza uma consulta: aprovação com as consultas de partida; o histórico cresce, a revisão sobe e o estado é o do front', async () => {
    como('supervisora'); const atual = (await lerOr()).j.items[0].guidance;
    const rec = { ...guia([...atual.history, evento('e2', 'allow-once', 'Pode uma.', 'supervisora')]), approval: { id: 'e2', at: '2000-01-01T00:00:00.000Z', by: 'x', baselineConsultationIds: ['c1', 'c2', 'c1'] } };
    const x = await orientar('900013', rec, 1); assert.equal(x.status, 200, x.t); const g = x.j.items[0].guidance;
    assert.equal(g.revision, 2); assert.equal(x.j.versions['900013'], 2); assert.equal(g.history.length, 2); assert.equal(g.history[1].by, 'Clara'); assert.equal(g.history[1].role, 'supervisora');
    assert.equal(g.pendingReview, false); assert.equal(g.requiresApproval, true); assert.deepEqual(g.approval.baselineConsultationIds, ['c1', 'c2']); assert.equal(g.approval.by, 'Clara');
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_clientes_orientacoes WHERE NOT pendente AND revisao = 2"), 1);
  });
  await passo('a administradora libera; depois retira o alerta (ativa=false); a atendente pode passar de novo à supervisora', async () => {
    como('administradora'); let g = (await lerOr()).j.items[0].guidance;
    let x = await orientar('900013', guia([...g.history, evento('e3', 'release', 'Liberada.', 'administradora')], { pendingReview: false, requiresApproval: false }), 2); assert.equal(x.status, 200, x.t); g = x.j.items[0].guidance; assert.equal(g.requiresApproval, false); assert.equal(g.active, true);
    x = await orientar('900013', guia([...g.history, evento('e4', 'close-alert', 'Retirado.', 'administradora')]), 3); assert.equal(x.status, 200, x.t); g = x.j.items[0].guidance; assert.equal(g.active, false);
    como('atendente'); x = await orientar('900013', guia([...g.history, evento('e5', 'request', 'De novo.')]), 4); assert.equal(x.status, 200, x.t); assert.equal(x.j.items[0].guidance.active, true); assert.equal(x.j.items[0].guidance.pendingReview, true);
  });
  await passo('histórico apagado, dois eventos de uma vez, evento antigo trocado e motivo vazio ou longo são recusados (422); cliente fora do legado é 404', async () => {
    como('supervisora'); const g = (await lerOr()).j.items[0].guidance; const v = g.revision;
    for (const mut of [guia([evento('z1', 'release', 'x', 'supervisora')]), guia([...g.history, evento('z1', 'release', 'a', 'supervisora'), evento('z2', 'release', 'b', 'supervisora')]),
      guia([{ ...g.history[0], reason: 'trocado' }, ...g.history.slice(1), evento('z3', 'release', 'x', 'supervisora')]), guia([...g.history, evento('z4', 'release', '   ', 'supervisora')]), guia([...g.history, evento('z5', 'release', 'x'.repeat(1001), 'supervisora')])]) {
      const x = await orientar('900013', mut, v); assert.equal(x.status, 422, x.t);
    }
    const y = await orientar('900099', guia([evento('e1', 'request', 'x')]), 0); assert.equal(y.status, 404); assert.equal(y.j.error.code, 'CLIENT_NOT_FOUND');
    const z = await orientar('abc', guia([evento('e1', 'request', 'x')]), 0); assert.equal(z.status, 400);
  });
  await passo('corrida: duas gravações com a mesma revisão, uma vence e a outra é 409', async () => {
    como('atendente');
    const [a, b] = await Promise.all([orientar('900014', guia([evento('c1', 'request', 'A')]), 0), orientar('900014', guia([evento('c2', 'request', 'B')]), 0)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.t} | ${b.t}`);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_clientes_orientacoes WHERE id_cliente = '900014'"), 1);
  });

  console.log('Observações');
  const idNota = 'nota-fch-1';
  const chaveNota = n();
  await passo('criar: texto aparado, autor e papel da sessão, instante do servidor; versão 1; a leitura da cliente devolve', async () => {
    como('atendente');
    const x = await gravarNota(nota(idNota, '900013', '  Prefere falar à noite.  ', { author: 'Hacker', createdAt: '2000-01-01T00:00:00.000Z', authorRole: 'administradora' }), 0, chaveNota);
    assert.equal(x.status, 200, x.t); const nt = x.j.items[0]; assert.equal(x.j.versions[idNota], 1);
    assert.equal(nt.text, 'Prefere falar à noite.'); assert.equal(nt.author, 'Khloe'); assert.equal(nt.authorRole, 'atendente'); assert.notEqual(nt.createdAt, '2000-01-01T00:00:00.000Z'); assert.ok(!nt.history);
    const l = await chamar('GET', '/client-notes?clientId=900013'); assert.equal(l.status, 200); assert.equal(l.j.items.length, 1); assert.equal(l.j.versions[idNota], 1);
    assert.equal((await chamar('GET', '/client-notes?clientId=900014')).j.items.length, 0);
  });
  await passo('mesma chave repete sem gravar de novo; outro corpo com a mesma chave é 409; versão velha é 409 VERSION_CHANGED', async () => {
    const x = await gravarNota(nota(idNota, '900013', '  Prefere falar à noite.  ', { author: 'Hacker', createdAt: '2000-01-01T00:00:00.000Z', authorRole: 'administradora' }), 0, chaveNota); assert.equal(x.status, 200, x.t);
    assert.equal((await gravarNota(nota(idNota, '900013', 'Outro.'), 0, chaveNota)).status, 409);
    const y = await gravarNota(nota(idNota, '900013', 'Outro.'), 0); assert.equal(y.status, 409); assert.equal(y.j.error.code, 'VERSION_CHANGED');
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_clientes_notas'), 1);
  });
  await passo('editar: a versão anterior vai para o histórico, quem editou e quando; qualquer perfil da equipe edita; texto igual não muda a versão', async () => {
    como('supervisora');
    const x = await gravarNota(nota(idNota, '900013', 'Prefere falar de manhã.'), 1); assert.equal(x.status, 200, x.t); const nt = x.j.items[0];
    assert.equal(x.j.versions[idNota], 2); assert.equal(nt.updatedBy, 'Clara'); assert.equal(nt.history.length, 1); assert.equal(nt.history[0].text, 'Prefere falar à noite.'); assert.equal(nt.history[0].author, 'Khloe'); assert.equal(nt.author, 'Khloe');
    const y = await gravarNota(nota(idNota, '900013', 'Prefere falar de manhã.'), 2); assert.equal(y.status, 200, y.t); assert.equal(y.j.versions[idNota], 2); assert.equal(y.j.items[0].history.length, 1);
  });
  await passo('formatação válida é guardada normalizada; formatação que não bate com o texto é descartada; texto vazio, longo e controle são 422', async () => {
    como('atendente');
    const t = 'Negrito aqui';
    const x = await gravarNota(nota('nota-fch-2', '900013', t, { formatting: { version: 1, text: t, ranges: [{ start: 0, end: 7, bold: true }] } }), 0); assert.equal(x.status, 200, x.t); assert.deepEqual(x.j.items[0].formatting.ranges, [{ start: 0, end: 7, bold: true }]);
    const y = await gravarNota(nota('nota-fch-3', '900013', t, { formatting: { version: 1, text: 'outro texto', ranges: [{ start: 0, end: 2, bold: true }] } }), 0); assert.equal(y.status, 200); assert.ok(!y.j.items[0].formatting);
    for (const ruim of ['', '   ', 'x'.repeat(4001), 'a\u0001b']) { const z = await gravarNota(nota(`nota-fch-x${ruim.length}`, '900013', ruim), 0); assert.equal(z.status, 422, z.t); }
  });
  await passo('nota de outra cliente com o mesmo id, id ruim e cliente fora do legado são recusados; a taróloga não grava', async () => {
    como('atendente');
    assert.equal((await gravarNota(nota(idNota, '900014', 'x'), 2)).status, 422);
    assert.equal((await gravarNota(nota('id ruim!', '900013', 'x'), 0)).status, 422);
    assert.equal((await gravarNota(nota('nota-fch-9', '900099', 'x'), 0)).status, 404);
    como('tarologa'); assert.equal((await gravarNota(nota('nota-fch-9', '900013', 'x'), 0)).status, 403); como('atendente');
  });

  console.log('Auditoria e escrita');
  await passo('auditoria: uma linha por gravação aplicada, na mesma transação (sem linha para recusa)', async () => {
    assert.ok(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'ficha.orientacao.gravar'") === 6);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_operacoes WHERE escopo = 'ficha.orientacao.gravar'"), await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'ficha.orientacao.gravar'"));
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_operacoes WHERE escopo = 'ficha.nota.gravar'"), await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'ficha.nota.gravar'"));
    assert.ok(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'ficha.nota.gravar'") >= 4);
  });
  await passo('gravação desligada no ambiente: 503 WRITE_DISABLED e nada é gravado; a leitura segue', async () => {
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false'; como('atendente');
    const antes = await contar('SELECT COUNT(*) AS n FROM gf_clientes_orientacoes') + await contar('SELECT COUNT(*) AS n FROM gf_clientes_notas');
    try {
      const x = await orientar('900015', guia([evento('w1', 'request', 'x')]), 0); assert.equal(x.status, 503); assert.equal(x.j.error.code, 'WRITE_DISABLED');
      const y = await gravarNota(nota('nota-fch-w', '900015', 'x'), 0); assert.equal(y.status, 503);
      assert.equal((await lerOr()).status, 200);
    } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_clientes_orientacoes') + await contar('SELECT COUNT(*) AS n FROM gf_clientes_notas'), antes);
  });
  await passo('o legado não é tocado: nenhuma escrita no MySQL (não configurado aqui)', async () => { assert.equal(process.env.GF_LEGADO_ESCRITA_ENABLED, undefined); });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close().catch(() => {});
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
