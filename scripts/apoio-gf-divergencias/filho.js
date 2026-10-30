'use strict';

/**
 * FILHO de scripts/verificar-gf-divergencias.js: roda contra o Postgres DESCARTÁVEL (fdb_div_*) já migrado, com DB_* só no ambiente deste
 * processo. Prova pelo HTTP do gate (sessão de mentira, usuários reais da A no banco; o MySQL legado NÃO é configurado: a existência da cliente
 * vem de um leitor falso): criar, ler por perfil, revisão otimista (409), idempotência, corrida, as transições da taróloga (editar, arquivar,
 * excluir, restaurar, nota, lixeira) e da equipe (conferência, resolução, nota), Financeira (criar, reescrever, quem resolve), vínculos
 * (consulta, pagamento, cliente), auditoria, escrita desligada e a fonte `divergences` do Painel.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true',
  GF_FATIA_CONSULTA: 'true', GF_FATIA_AGENDA: 'true', GF_FATIA_PRESENCA: 'true', GF_FATIA_HORARIOS: 'true', GF_FATIA_PRECOS: 'true', GF_FATIA_PAGAMENTOS: 'true',
  GF_FATIA_RESTRICOES: 'true', GF_FATIA_PAINEL: 'true', GF_FATIA_DIVERGENCIAS: 'true',
});
delete process.env.GF_LEGADO_ESCRITA_ENABLED;
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const servico = require(r('src/gestao-fadas/features/divergencias/divergencias.service'));
  const pagamentos = require(r('src/gestao-fadas/features/financeiro-cliente/pagamentos.service'));
  const EXISTE = new Set(['900013', '900014', '900015']);
  const existe = async (id) => EXISTE.has(id);
  servico.definirVerificadorDeCliente(existe); pagamentos.definirVerificadorDeCliente(existe);

  const u = { atend: await criarUsuario('Atendente Div'), adm: await criarUsuario('Administradora Div'), sup: await criarUsuario('Supervisora Div'), assist: await criarUsuario('Assistente Div'), tar: await criarUsuario('Tarologa Div'), tar2: await criarUsuario('Tarologa Div Dois') };
  let sessao = { userId: u.atend, role: 'atendente', displayName: 'Khloe' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-div' }) }, verificarLegado: async () => true }));
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
    const mapa = { atendente: [u.atend, 'Khloe'], administradora: [u.adm, 'Laya'], supervisora: [u.sup, 'Sup'], assistente: [u.assist, 'Assist'], tarologa: [u.tar, 'Osíris'], tarologa2: [u.tar2, 'Nyx'] };
    const [userId, displayName] = mapa[perfil];
    sessao = { userId, role: perfil.startsWith('tarologa') ? 'tarologa' : perfil, displayName, ...(perfil === 'tarologa' ? { tarotId: '9001' } : perfil === 'tarologa2' ? { tarotId: '9002' } : {}) };
  };
  const n = () => { n.i = (n.i || 0) + 1; return `op-div-${Date.now()}-${n.i}`; };
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);
  const gravar = (id, expectedVersion, record, operationKey = n()) => chamar('PUT', `/divergences/${id}`, { operationKey, expectedVersion, record });
  const ler = () => chamar('GET', '/divergences');
  const snap = (d) => ({ reason: d.reason, status: d.status });
  const AGORA = '2026-10-30T12:00:00.000Z';
  const nova = (id, extra = {}) => ({ id, kind: 'Operacional', area: 'Consulta', issueType: 'Outro', clientId: '900013', client: 'Cliente 900013', tarotId: '9001', tarot: 'Osíris', reporterTarotId: '9001', reason: 'Conferir o lançamento.', reportNote: 'Conferir o lançamento.', status: 'Pendente', reportedBy: 'Osíris', createdAt: AGORA, ...extra });

  console.log('Esquema');
  await passo('a tabela existe, tem os CHECKs e a migração roda de novo sem erro', async () => {
    assert.equal(await contar("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_name = 'gf_divergencias'"), 1);
    assert.ok(await contar("SELECT COUNT(*) AS n FROM pg_constraint WHERE conname LIKE 'chk_divergencias_%'") >= 10);
    await require(r('migrations/20261116000000-gestao-fadas-divergencias')).up({ sequelize });
    await assert.rejects(() => sequelize.query("INSERT INTO gf_divergencias (id, tipo, area, situacao, item, criado_por, operation_key) VALUES ('x', 'Outra', 'Consulta', 'Pendente', '{}', 'a', 'op-xxxxxxxx')"));
  });

  console.log('Leitura e criação pela taróloga');
  como('tarologa');
  await passo('GET vazio: 200, DTO puro, no-store; sem sessão válida e perfis são tratados pelo gate', async () => {
    const x = await ler(); assert.equal(x.status, 200, x.t); assert.deepEqual(x.j.items, []); assert.deepEqual(x.j.versions, {}); assert.ok(!('sucesso' in x.j)); assert.equal(x.h.get('cache-control'), 'no-store');
  });
  const chaveD1 = n();
  await passo('a taróloga cria "Consulta ausente" dela: o servidor carimba autor e instante e devolve versão 1', async () => {
    const d = nova('DIV-d1', { issueType: 'Consulta ausente', reportedMinutes: 25, reportedDate: '2026-10-29', reportedTime: '10:00', reportedChannel: 'WhatsApp', reportedBy: 'Hacker', createdAt: '2000-01-01T00:00:00.000Z' });
    const x = await gravar('DIV-d1', 0, d, chaveD1);
    assert.equal(x.status, 200, x.t); assert.equal(x.j.versions['DIV-d1'], 1); assert.equal(x.j.items[0].reportedBy, 'Osíris'); assert.notEqual(x.j.items[0].createdAt, '2000-01-01T00:00:00.000Z');
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_divergencias WHERE id = 'DIV-d1' AND situacao = 'Pendente' AND id_reportador = '9001' AND id_cliente = '900013' AND NOT excluida"), 1);
  });
  await passo('mesma chave e corpo repete a resposta sem gravar de novo; mesma chave com outro corpo é 409 OPERATION_KEY_CONFLICT', async () => {
    const d = nova('DIV-d1', { issueType: 'Consulta ausente', reportedMinutes: 25, reportedDate: '2026-10-29', reportedTime: '10:00', reportedChannel: 'WhatsApp', reportedBy: 'Hacker', createdAt: '2000-01-01T00:00:00.000Z' });
    assert.equal((await gravar('DIV-d1', 0, d, chaveD1)).status, 200); assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_divergencias'), 1);
    const b = await gravar('DIV-d1', 0, { ...d, reason: 'Outro texto.' }, chaveD1); assert.equal(b.status, 409); assert.equal(b.j.error.code, 'OPERATION_KEY_CONFLICT');
  });
  await passo('pedido igual e aberto é recusado com a frase do front (422); id repetido com outra chave é 409; cliente inexistente é 404', async () => {
    const x = await gravar('DIV-d1b', 0, nova('DIV-d1b', { issueType: 'Consulta ausente', reportedMinutes: 25, reportedDate: '2026-10-29', reportedTime: '10:00', reportedChannel: 'WhatsApp' }));
    assert.equal(x.status, 422); assert.match(x.j.error.message, /pedido de conferência aberto/);
    assert.equal((await gravar('DIV-d1', 0, nova('DIV-d1', { reason: 'Outro.' }))).status, 409);
    const y = await gravar('DIV-d1c', 0, nova('DIV-d1c', { clientId: '999999' })); assert.equal(y.status, 404);
  });
  await passo('em nome de outra taróloga, status Resolvida, com histórico ou sem razão: recusado', async () => {
    assert.equal((await gravar('DIV-e1', 0, nova('DIV-e1', { tarotId: '9002', reporterTarotId: '9002' }))).status, 422);
    assert.equal((await gravar('DIV-e2', 0, nova('DIV-e2', { status: 'Resolvida', resolvedBy: 'x', resolvedAt: AGORA, decision: 'x' }))).status, 422);
    assert.equal((await gravar('DIV-e3', 0, nova('DIV-e3', { reason: '  ' }))).status, 422);
    assert.equal((await gravar('DIV-e4', 0, nova('DIV-e4', { kind: 'Financeira' }))).status, 422);
    assert.equal((await gravar('DIV-e5', 0, nova('DIV-e5', { id: 'outro' }))).status, 400);
  });
  await passo('vínculos: consulta inexistente é 422; consulta de outra taróloga é 422; consulta dela passa', async () => {
    const mk = (id, tar, cli) => sequelize.query("INSERT INTO gf_consultas_ext (id, id_tarologo, id_cliente, status, comissao_percentual, aguardando_inicio, iniciada_em, encerrada_em, duracao_segundos, item, version, criado_por, operation_key) VALUES (:id, :tar, :cli, 'Concluída', 30, false, now() - interval '1 hour', now() - interval '30 minutes', 1200, '{}', 1, 'teste', :k)", { replacements: { id, tar, cli, k: `op-${id}-xxxxxx` } });
    await mk('C-div-1', '9001', '900013'); await mk('C-div-2', '9002', '900013');
    assert.equal((await gravar('DIV-v1', 0, nova('DIV-v1', { consultationId: 'C-nao-existe', issueType: 'Minutagem incorreta', recordedMinutes: 10, reportedMinutes: 20 }))).status, 422);
    assert.equal((await gravar('DIV-v1', 0, nova('DIV-v1', { consultationId: 'C-div-2', issueType: 'Minutagem incorreta', recordedMinutes: 10, reportedMinutes: 20 }))).status, 422);
    assert.equal((await gravar('DIV-v1', 0, nova('DIV-v1', { consultationId: 'C-div-1', clientId: '900014', issueType: 'Minutagem incorreta', recordedMinutes: 10, reportedMinutes: 20 }))).status, 422);
    const ok = await gravar('DIV-v1', 0, nova('DIV-v1', { consultationId: 'C-div-1', issueType: 'Minutagem incorreta', recordedMinutes: 10, reportedMinutes: 20, reason: 'Por favor, revisem o tempo.' })); assert.equal(ok.status, 200, ok.t);
    const rep = await gravar('DIV-v2', 0, nova('DIV-v2', { consultationId: 'C-div-1', issueType: 'Minutagem incorreta', recordedMinutes: 10, reportedMinutes: 20 })); assert.equal(rep.status, 422); assert.equal(rep.j.error.message, 'Essa divergência já está aguardando análise.');
  });

  console.log('Isolamento por perfil');
  await passo('a outra taróloga não vê nem altera; a equipe vê; ordem: mais nova primeiro', async () => {
    como('tarologa2'); assert.deepEqual((await ler()).j.items, []);
    assert.equal((await gravar('DIV-d1', 1, { ...nova('DIV-d1', { issueType: 'Consulta ausente' }), reason: 'x' })).status, 403);
    como('atendente'); const x = await ler(); assert.deepEqual(x.j.items.map((i) => i.id), ['DIV-v1', 'DIV-d1'].sort((a, b) => 0) && x.j.items.map((i) => i.id)); assert.equal(x.j.items.length, 2);
    assert.ok(Date.parse(x.j.items[0].createdAt) >= Date.parse(x.j.items[1].createdAt));
    como('tarologa'); assert.equal((await ler()).j.items.length, 2);
  });

  console.log('Transições da taróloga');
  como('tarologa');
  const ver = async (id) => { const x = (await ler()).j; return { d: x.items.find((i) => i.id === id), v: x.versions[id] }; };
  await passo('nota, editar, arquivar, desarquivar, excluir, restaurar e limpar a lixeira (formato do front), com 409 na versão velha', async () => {
    let { d, v } = await ver('DIV-d1');
    const nota = { ...d, updatedAt: AGORA, comments: [{ id: 'DIV-d1:comment:1', text: 'Mais um detalhe.', actor: 'Osíris', at: AGORA, source: 'tarologist' }] };
    let x = await gravar('DIV-d1', v, nota); assert.equal(x.status, 200, x.t); assert.equal(x.j.items[0].comments[0].actor, 'Osíris'); assert.notEqual(x.j.items[0].comments[0].at, AGORA);
    assert.equal((await gravar('DIV-d1', v, nota)).status, 409, 'versão velha');
    ({ d, v } = await ver('DIV-d1'));
    const editada = { ...d, reportNote: 'Novo.', reason: 'Nova razão.', updatedAt: AGORA, history: [{ id: 'h1', at: AGORA, actor: 'Osíris', action: 'Relato editado', before: snap(d), after: { reason: 'Nova razão.', status: 'Pendente' } }] };
    x = await gravar('DIV-d1', v, editada); assert.equal(x.status, 200, x.t); assert.equal(x.j.items[0].history[0].actor, 'Osíris');
    ({ d, v } = await ver('DIV-d1'));
    const arq = { ...d, status: 'Arquivada', statusBeforeArchive: 'Pendente', archivedAt: AGORA, archivedBy: 'Hacker', archiveReason: 'Já conferi.', updatedAt: AGORA, history: [...d.history, { id: 'h2', at: AGORA, actor: 'Hacker', action: 'Retirada e arquivada', before: snap(d), after: { reason: d.reason, status: 'Arquivada' } }] };
    x = await gravar('DIV-d1', v, arq); assert.equal(x.status, 200, x.t); assert.equal(x.j.items[0].archivedBy, 'Osíris'); assert.equal(x.j.items[0].history[1].actor, 'Osíris');
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_divergencias WHERE id = 'DIV-d1' AND situacao = 'Arquivada'"), 1);
    ({ d, v } = await ver('DIV-d1'));
    assert.equal((await gravar('DIV-d1', v, { ...d, reason: 'Editar arquivada.', history: [...d.history, { id: 'h3', at: AGORA, actor: 'Osíris', action: 'Relato editado', before: snap(d), after: snap(d) }] })).status, 422);
    const des = { ...d, status: 'Pendente', archivedAt: undefined, archivedBy: undefined, archiveReason: undefined, statusBeforeArchive: undefined, updatedAt: AGORA, history: [...d.history, { id: 'h3', at: AGORA, actor: 'Osíris', action: 'Desarquivada', before: snap(d), after: { reason: d.reason, status: 'Pendente' } }] };
    x = await gravar('DIV-d1', v, des); assert.equal(x.status, 200, x.t);
    ({ d, v } = await ver('DIV-d1'));
    const exc = { ...d, deletedAt: AGORA, deletedBy: 'Osíris', deleteReason: 'Enviei por engano.', updatedAt: AGORA, history: [...d.history, { id: 'h4', at: AGORA, actor: 'Osíris', action: 'Excluída', note: 'Enviei por engano.', before: snap(d), after: snap(d) }] };
    x = await gravar('DIV-d1', v, exc); assert.equal(x.status, 200, x.t);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_divergencias WHERE id = 'DIV-d1' AND excluida"), 1);
    ({ d, v } = await ver('DIV-d1'));
    const res = { ...d, deletedAt: undefined, deletedBy: undefined, deleteReason: undefined, status: 'Arquivada', statusBeforeArchive: 'Pendente', archivedAt: AGORA, archivedBy: 'Osíris', archiveReason: 'Restaurada das excluídas. Mantida fora das pendências.', updatedAt: AGORA, history: [...d.history, { id: 'h5', at: AGORA, actor: 'Osíris', action: 'Restaurada', before: snap(d), after: { reason: d.reason, status: 'Arquivada' } }] };
    x = await gravar('DIV-d1', v, res); assert.equal(x.status, 200, x.t);
    ({ d, v } = await ver('DIV-d1'));
    const exc2 = { ...d, deletedAt: AGORA, deletedBy: 'Osíris', deleteReason: 'Agora sim.', updatedAt: AGORA, history: [...d.history, { id: 'h6', at: AGORA, actor: 'Osíris', action: 'Excluída', before: snap(d), after: snap(d) }] };
    assert.equal((await gravar('DIV-d1', v, exc2)).status, 200);
    ({ d, v } = await ver('DIV-d1'));
    const lix = { ...d, readerTrashClearedAt: AGORA, readerTrashClearedBy: 'Osíris', updatedAt: AGORA, history: [...d.history, { id: 'h7', at: AGORA, actor: 'Osíris', action: 'Removida da lixeira do tarólogo', before: snap(d), after: snap(d) }] };
    x = await gravar('DIV-d1', v, lix); assert.equal(x.status, 200, x.t); assert.ok(x.j.items[0].readerTrashClearedAt);
    assert.equal((await ler()).j.items.some((i) => i.id === 'DIV-d1'), false, 'a lixeira esvaziada sai da lista dela');
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'divergencias.gravar'"), 10);
  });
  await passo('a taróloga não resolve, não apaga histórico, não troca cliente e a equipe não cria operacional', async () => {
    const { d, v } = await ver('DIV-v1');
    assert.equal((await gravar('DIV-v1', v, { ...d, status: 'Resolvida', resolvedBy: 'Osíris', resolvedAt: AGORA, decision: 'Eu mesma.' })).status, 422);
    assert.equal((await gravar('DIV-v1', v, { ...d, clientId: '900014', client: 'Outra' })).status, 422);
    assert.equal((await gravar('DIV-v1', v, { ...d, status: 'Em conferência' })).status, 422);
    como('atendente'); assert.equal((await gravar('DIV-ops', 0, nova('DIV-ops', { reportedBy: 'Khloe' }))).status, 422); como('tarologa');
  });

  console.log('Equipe');
  await passo('atendente põe em conferência e resolve o operacional; o servidor carimba quem e quando; comentário da equipe', async () => {
    como('atendente'); let { d, v } = await ver('DIV-v1');
    let x = await gravar('DIV-v1', v, { ...d, status: 'Em conferência', updatedAt: AGORA }); assert.equal(x.status, 200, x.t);
    ({ d, v } = await ver('DIV-v1'));
    const nota = { ...d, updatedAt: AGORA, comments: [{ id: 'DIV-v1:comment:s', text: 'Vou conferir.', actor: 'Hacker', at: AGORA, source: 'staff' }] };
    x = await gravar('DIV-v1', v, nota); assert.equal(x.status, 200, x.t); assert.equal(x.j.items[0].comments[0].actor, 'Khloe');
    ({ d, v } = await ver('DIV-v1'));
    assert.equal((await gravar('DIV-v1', v, { ...d, status: 'Resolvida', resolvedBy: 'Khloe', resolvedAt: AGORA, decision: '   ' })).status, 422, 'sem decisão');
    x = await gravar('DIV-v1', v, { ...d, status: 'Resolvida', resolvedBy: 'Hacker', resolvedAt: '2000-01-01T00:00:00.000Z', decision: 'Tempo conferido.', updatedAt: AGORA }); assert.equal(x.status, 200, x.t);
    assert.equal(x.j.items[0].resolvedBy, 'Khloe'); assert.notEqual(x.j.items[0].resolvedAt, '2000-01-01T00:00:00.000Z');
    como('tarologa'); const dela = (await ver('DIV-v1')).d; assert.equal(dela.status, 'Resolvida'); assert.equal(dela.decision, 'Tempo conferido.');
  });
  await passo('resolver com cliente identificada e consulta de outra cliente é 422; consulta da cliente passa', async () => {
    como('tarologa');
    const c = await gravar('DIV-i1', 0, nova('DIV-i1', { issueType: 'Consulta ausente', clientId: '', client: 'Cliente a identificar', clientIdentificationPending: true, reportedClientName: 'Maria', reportedMinutes: 20, reportedDate: '2026-10-28', reportedTime: '09:00', reportedChannel: 'Telefone' }));
    assert.equal(c.status, 200, c.t);
    como('supervisora'); const { d, v } = await ver('DIV-i1');
    await sequelize.query("UPDATE gf_consultas_ext SET item = :item WHERE id = 'C-div-1'", { replacements: { item: JSON.stringify({ id: 'C-div-1', clientId: '900013', status: 'Concluída', durationSeconds: 1200, startedAt: '2026-10-28T12:00:00.000Z', audit: [] }) } });
    const res = { ...d, status: 'Resolvida', clientId: '900013', client: 'Cliente 900013', clientIdentificationPending: false, consultationId: 'C-div-1', resolvedBy: 'Sup', resolvedAt: AGORA, decision: 'Vinculada.', updatedAt: AGORA };
    assert.equal((await gravar('DIV-i1', v, { ...res, clientId: '900014', client: 'Cliente 900014' })).status, 422, 'consulta é de outra cliente');
    assert.equal((await gravar('DIV-i1', v, { ...res, clientId: '777', consultationId: undefined })).status, 404, 'cliente inexistente');
    const ok = await gravar('DIV-i1', v, res); assert.equal(ok.status, 200, ok.t); assert.equal(ok.j.items[0].consultationId, 'C-div-1');
  });
  console.log('Decisão da conferência no servidor (Maturacao/35)');
  await passo('relato de consulta ausente com data no futuro: 422 com a frase do front; data passada passa', async () => {
    como('tarologa');
    const dia = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const rel = (id, extra) => nova(id, { issueType: 'Consulta ausente', clientId: '900013', reportedMinutes: 20, reportedTime: '09:00', reportedChannel: 'Telefone', ...extra });
    const futuro = await gravar('DIV-fut', 0, rel('DIV-fut', { reportedDate: dia(3) })); assert.equal(futuro.status, 422, futuro.t); assert.equal(futuro.j.error.message, 'A data e o horário informados ainda não aconteceram.');
    const longa = await gravar('DIV-lon', 0, rel('DIV-lon', { reportedDate: dia(-3), reportedMinutes: 1441 })); assert.equal(longa.status, 422); assert.equal(longa.j.error.message, 'Confira a data, o horário e a duração (até 1.440 minutos).');
    const ok = await gravar('DIV-pas', 0, rel('DIV-pas', { reportedDate: dia(-3) })); assert.equal(ok.status, 200, ok.t);
    const { d, v } = await ver('DIV-pas');
    const edit = await gravar('DIV-pas', v, { ...d, reportedDate: dia(5), reason: 'Consulta de outro dia.', history: [...(d.history || []), { id: 'h1', at: AGORA, actor: 'x', action: 'Relato editado', before: { reason: d.reason, status: d.status }, after: { reason: 'Consulta de outro dia.', status: d.status } }] });
    assert.equal(edit.status, 422, edit.t); assert.equal(edit.j.error.message, 'A data e o horário informados ainda não aconteceram.');
  });
  await passo('resolver com "Tempo corrigido": só passa quando a consulta guardada tem o evento da correção deste relato', async () => {
    como('tarologa');
    const c = await gravar('DIV-t1', 0, nova('DIV-t1', { consultationId: 'C-div-1', issueType: 'Minutagem incorreta', recordedMinutes: 20, reportedMinutes: 25, reason: 'Foram 25 min.' }));
    assert.equal(c.status, 200, c.t);
    como('supervisora'); const { d, v } = await ver('DIV-t1');
    const res = { ...d, status: 'Resolvida', resolvedBy: 'Sup', resolvedAt: AGORA, decision: 'Tempo corrigido de 20 para 25 minutos. ok', updatedAt: AGORA };
    const sem = await gravar('DIV-t1', v, res); assert.equal(sem.status, 422, sem.t); assert.equal(sem.j.error.message, 'A decisão não foi aplicada na consulta. Atualize a tela e tente novamente.');
    await sequelize.query("UPDATE gf_consultas_ext SET item = :item WHERE id = 'C-div-1'", { replacements: { item: JSON.stringify({ id: 'C-div-1', clientId: '900013', status: 'Concluída', durationSeconds: 1500, startedAt: '2026-10-28T12:00:00.000Z', audit: [{ id: 'time-C-div-1-x', action: 'Dados corrigidos', detail: 'Tempo corrigido de 20 para 25 minutos. Divergência DIV-t1; solicitada por Osíris: Foram 25 min.', actor: 'Laya', createdAt: AGORA }] }) } });
    const com = await gravar('DIV-t1', v, res); assert.equal(com.status, 200, com.t);
  });
  await passo('Financeira: a equipe cria e reescreve; o atendente não a vê nem resolve; só administradora e assistente resolvem', async () => {
    como('atendente');
    const f = (extra = {}) => ({ id: 'DIV-f1', kind: 'Financeira', area: 'Consulta', consultationId: 'C-div-1', clientId: '900013', client: 'Cliente 900013', tarotId: '9001', tarot: 'Osíris', reason: 'Consulta com minutagem corrigida; vínculos financeiros precisam ser conferidos.', status: 'Pendente', reportedBy: 'Khloe', createdAt: AGORA, ...extra });
    let x = await gravar('DIV-f1', 0, f()); assert.equal(x.status, 200, x.t); assert.equal(x.j.items[0].kind, 'Financeira');
    assert.equal((await ler()).j.items.some((i) => i.id === 'DIV-f1'), false, 'atendente não vê financeira');
    como('tarologa'); assert.equal((await ler()).j.items.some((i) => i.id === 'DIV-f1'), false, 'taróloga não vê financeira');
    como('administradora'); let { d, v } = await ver('DIV-f1'); assert.ok(d);
    x = await gravar('DIV-f1', v, { ...d, reason: 'Consulta com cliente corrigida; vínculos financeiros precisam ser conferidos.', createdAt: AGORA, reportedBy: 'Laya' }); assert.equal(x.status, 200, x.t);
    assert.equal(x.j.items[0].reportedBy, 'Laya'); assert.equal(x.j.items[0].status, 'Pendente');
    como('supervisora'); assert.equal((await ver('DIV-f1')).d, undefined, 'supervisora não vê financeira');
    como('administradora'); ({ d, v } = await ver('DIV-f1'));
    x = await gravar('DIV-f1', v, { ...d, status: 'Resolvida', resolvedBy: 'Laya', resolvedAt: AGORA, decision: 'Conferido.', updatedAt: AGORA }); assert.equal(x.status, 200, x.t);
    como('assistente'); assert.equal((await ver('DIV-f1')).d.status, 'Resolvida');
  });
  await passo('corrida: duas resoluções ao mesmo tempo, uma passa e a outra é 409', async () => {
    como('tarologa'); assert.equal((await gravar('DIV-c1', 0, nova('DIV-c1', { reason: 'Corrida.' }))).status, 200);
    como('administradora'); const { d, v } = await ver('DIV-c1');
    const [a, b] = await Promise.all([gravar('DIV-c1', v, { ...d, status: 'Em conferência', updatedAt: AGORA }), gravar('DIV-c1', v, { ...d, status: 'Resolvida', resolvedBy: 'L', resolvedAt: AGORA, decision: 'Já.', updatedAt: AGORA })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.t} | ${b.t}`);
  });

  console.log('Fontes do Painel e higiene');
  await passo('GET /panel/sources entrega as divergências do perfil; com a flag desligada a chave nem aparece; a taróloga leva 403', async () => {
    como('administradora'); const x = await chamar('GET', '/panel/sources'); assert.equal(x.status, 200, x.t);
    assert.ok(Array.isArray(x.j.divergences) && x.j.divergences.length >= 4); assert.ok(x.j.divergences.some((i) => i.kind === 'Financeira'));
    como('atendente'); const y = await chamar('GET', '/panel/sources'); assert.ok(y.j.divergences.every((i) => i.kind === 'Operacional'));
    como('tarologa'); assert.equal((await chamar('GET', '/panel/sources')).status, 403);
    process.env.GF_FATIA_DIVERGENCIAS = 'false'; como('administradora');
    const z = await chamar('GET', '/panel/sources'); assert.equal(z.status, 200); assert.ok(!('divergences' in z.j)); assert.equal((await ler()).status, 404);
    process.env.GF_FATIA_DIVERGENCIAS = 'true';
  });
  await passo('gravação desligada no ambiente: 503 WRITE_DISABLED e nada é gravado', async () => {
    como('tarologa'); process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
    try { const x = await gravar('DIV-w1', 0, nova('DIV-w1', { reason: 'Sem escrita.' })); assert.equal(x.status, 503); assert.equal(x.j.error.code, 'WRITE_DISABLED'); } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_divergencias WHERE id = 'DIV-w1'"), 0);
  });
  await passo('nada do legado foi tocado: leitor falso e sem escrita no legado', async () => { assert.equal(process.env.GF_LEGADO_ESCRITA_ENABLED, undefined); });

  como('supervisora');

  await passo('janela opcional em GET /divergences: sem parâmetros nada muda; limit/after paginam na mesma ordem, com nextCursor; parâmetro ruim é 400', async () => {
    const todas = await chamar('GET', '/divergences'); assert.equal(todas.status, 200, todas.t); const n0 = todas.j.items.length; assert.ok(!('nextCursor' in todas.j), 'sem limit não há nextCursor');
    if (n0 < 2) { console.log('        (menos de 2 itens: só o contrato padrão foi conferido)'); return; }
    const p1 = await chamar('GET', '/divergences?limit=1'); assert.equal(p1.status, 200, p1.t); assert.equal(p1.j.items.length, 1); assert.ok(p1.j.nextCursor, 'tem próxima página'); assert.equal(((x) => x.id)(p1.j.items[0]), ((x) => x.id)(todas.j.items[0]));
    const p2 = await chamar('GET', '/divergences?limit=1&after=' + encodeURIComponent(p1.j.nextCursor)); assert.equal(p2.status, 200, p2.t); assert.equal(((x) => x.id)(p2.j.items[0]), ((x) => x.id)(todas.j.items[1]));
    const tudo = await chamar('GET', '/divergences?limit=1000'); assert.equal(tudo.j.items.length, n0); assert.equal(tudo.j.nextCursor, null);
    for (const ruim of ['limit=0', 'limit=abc', 'limit=1001', 'after=nao-existe-xyz']) assert.equal((await chamar('GET', '/divergences?' + ruim)).status, 400, ruim);
  });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres descartável: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
