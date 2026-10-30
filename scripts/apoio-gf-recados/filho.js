'use strict';

/**
 * FILHO de scripts/verificar-gf-recados.js: roda contra o Postgres DESCARTÁVEL (fdb_rec_*) já migrado, com DB_* só no ambiente deste processo.
 * Prova pelo HTTP do gate (sessão de mentira, usuários reais da A no banco; o MySQL legado NÃO é configurado): criar (quadro, mensagem, nota da
 * taróloga), idempotência, 409 de versão, edição só do autor, resposta, OK, leitura por conta, fixar/arquivar só da própria conta, visibilidade por
 * perfil, corrida, auditoria, gravação desligada e fatia desligada.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_RECADOS: 'true' });
delete process.env.GF_LEGADO_ESCRITA_ENABLED;
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const contasMod = require(r('src/gestao-fadas/features/recados/recados.contas'));
  const U = { ate: await criarUsuario('Atendente Rec'), sup: await criarUsuario('Supervisora Rec'), adm: await criarUsuario('Administradora Rec'), osi: await criarUsuario('Osiris Rec'), nyx: await criarUsuario('Nyx Rec') };
  contasMod.definirListaDeContas(async () => [
    { id: U.ate, name: 'Khloe', role: 'atendente', active: true }, { id: U.sup, name: 'Clara', role: 'supervisora', active: true }, { id: U.adm, name: 'Laya', role: 'administradora', active: true },
    { id: U.osi, name: 'Osíris', role: 'tarologa', tarotId: '9001', active: true }, { id: U.nyx, name: 'Nyx', role: 'tarologa', tarotId: '9002', active: true }]);
  const PERFIL = { ate: ['atendente', 'Khloe'], sup: ['supervisora', 'Clara'], adm: ['administradora', 'Laya'], osi: ['tarologa', 'Osíris', '9001'], nyx: ['tarologa', 'Nyx', '9002'] };
  let sessao;
  const como = (k, sem) => { const [role, displayName, tarotId] = PERFIL[k]; sessao = { userId: U[k], role, displayName, ...(tarotId && !sem ? { tarotId } : {}) }; };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-rec' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 300), h: resp.headers };
  };
  const n = () => { n.i = (n.i || 0) + 1; return `op-rec-${Date.now()}-${n.i}`; };
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);
  const put = (id, record, v = 0, key = n()) => chamar('PUT', `/notes/${id}`, { operationKey: key, expectedVersion: v, record });
  const lerIds = async () => (await chamar('GET', '/notes')).j.items.map((i) => i.id).sort();
  const quadro = (id, extra = {}) => ({ id, tarotId: '9001', tarot: 'Osíris', text: 'Osíris chega às 15h', at: '2000-01-01T00:00:00.000Z', by: 'Hacker', actorId: 'zzz', source: 'staff', date: '2026-10-12', subject: 'Mudança de horário', startDate: '2026-10-12', endDate: '2026-10-12',
    originalQuote: 'Vou chegar às 15h', subjectTarotId: '9001', delivery: { kind: 'board', audience: 'staff', senderId: U.ate, recipientIds: [U.ate, U.sup, U.adm], excludedIds: [], label: 'Toda a equipe de atendimento' }, ...extra });
  const mensagem = (id, extra = {}) => ({ ...quadro(id), tarotId: '9001', subjectTarotId: undefined, originalQuote: undefined, subject: 'Diversos', delivery: { kind: 'message', audience: 'tarologist', senderId: U.ate, recipientIds: [U.osi], excludedIds: [], label: 'Osíris' }, ...extra });

  console.log('Esquema');
  await passo('2 tabelas da fatia existem e a migração roda de novo sem erro', async () => {
    assert.equal(await contar("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('gf_recados','gf_recados_pessoais')"), 2);
    await require(r('migrations/20261115000000-gestao-fadas-recados')).up({ sequelize });
  });

  console.log('Criar e ler');
  como('ate');
  const chave = n();
  await passo('quadro da equipe: o servidor carimba autor e instante; versão 1; DTO puro e no-store', async () => {
    const x = await put('q1', quadro('q1'), 0, chave);
    assert.equal(x.status, 200, x.t); const nota = x.j.items[0];
    assert.equal(nota.by, 'Khloe'); assert.equal(nota.actorId, U.ate); assert.notEqual(nota.at, '2000-01-01T00:00:00.000Z'); assert.equal(x.j.versions.q1, 1); assert.ok(!('sucesso' in x.j));
    assert.equal(x.h.get('cache-control'), 'no-store');
  });
  await passo('mesma chave e corpo repete a resposta sem gravar de novo; mesma chave com outro corpo é 409 OPERATION_KEY_CONFLICT', async () => {
    assert.equal((await put('q1', quadro('q1'), 0, chave)).status, 200);
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_recados'), 1);
    const b = await put('q1', quadro('q1', { text: 'Outro' }), 0, chave);
    assert.equal(b.status, 409); assert.equal(b.j.error.code, 'OPERATION_KEY_CONFLICT');
  });
  await passo('mensagem para a taróloga; criar de novo o mesmo id com outra chave é 409 VERSION_CHANGED', async () => {
    assert.equal((await put('m1', mensagem('m1'))).status, 200);
    const x = await put('m1', mensagem('m1'));
    assert.equal(x.status, 409); assert.equal(x.j.error.code, 'VERSION_CHANGED');
  });
  await passo('visibilidade: a taróloga vê só a mensagem dela; o quadro fica só da equipe; outra taróloga não vê nada', async () => {
    como('osi'); assert.deepEqual(await lerIds(), ['m1']);
    como('nyx'); assert.deepEqual(await lerIds(), []);
    como('sup'); assert.deepEqual(await lerIds(), ['q1']);
    como('ate'); assert.deepEqual(await lerIds(), ['m1', 'q1']);
  });
  await passo('a leitura traz a lista de contas; taróloga sem tarotId e a que tenta gravar no quadro levam 403/422', async () => {
    como('ate'); const x = await chamar('GET', '/notes'); assert.equal(x.j.accounts.length, 5);
    como('osi', true); assert.equal((await chamar('GET', '/notes')).status, 403);
    como('osi'); const y = await put('q9', quadro('q9'));
    assert.equal(y.status, 422);
  });
  await passo('a taróloga cria a nota dela (source tarologist, só no próprio tarotId) e outro tarólogo não grava no id dela', async () => {
    como('osi');
    const nota = { id: 'n1', tarotId: '9001', tarot: 'Osíris', text: 'Chego às 14h', at: '2026-10-12T10:00:00.000Z', by: 'x', source: 'tarologist', date: '2026-10-12', subject: 'Escala', startDate: '2026-10-12', endDate: '2026-10-12' };
    const x = await put('n1', nota); assert.equal(x.status, 200, x.t); assert.equal(x.j.items[0].actorId, U.osi);
    como('nyx'); assert.equal((await put('n2', { ...nota, id: 'n2' })).status, 422);
  });

  console.log('Edição, resposta, OK');
  await passo('só o autor edita; versão velha é 409; a edição guarda a revisão e sobe a versão', async () => {
    como('sup');
    const q = (await chamar('GET', '/notes')).j.items.find((i) => i.id === 'q1');
    const ed = { ...q, text: 'Novo texto', updatedAt: '2026-10-12T12:00:00.000Z', revisions: [{ version: q.at, text: q.text, at: '2026-10-12T12:00:00.000Z', by: 'Clara' }] };
    assert.equal((await put('q1', ed, 1)).status, 422);
    como('ate');
    assert.equal((await put('q1', ed, 5)).status, 409);
    const ok = await put('q1', ed, 1);
    assert.equal(ok.status, 200, ok.t); assert.equal(ok.j.versions.q1, 2); assert.equal(ok.j.items[0].revisions.length, 1); assert.equal(ok.j.items[0].revisions[0].by, 'Khloe');
    assert.equal((await put('q1', { ...ed, revisions: [] }, 2)).status, 422);
    // Edição montada sobre a versão velha (outra aba): o atraso é conflito, não erro de regra.
    const velhaEd = await put('q1', { ...ed, text: 'Da aba velha', updatedAt: '2026-10-12T12:30:00.000Z' }, 1);
    assert.equal(velhaEd.status, 409); assert.equal(velhaEd.j.error.code, 'VERSION_CHANGED');
  });
  await passo('resposta da taróloga na conversa dela; a de outra taróloga e a do quadro (que ela não vê) são recusadas', async () => {
    const resp = (id, extra = {}) => ({ ...mensagem(id), id, replyToId: 'm1', replySequence: 1, source: 'tarologist', text: 'Combinado', ...extra });
    como('osi'); const x = await put('r1', resp('r1')); assert.equal(x.status, 200, x.t);
    como('nyx'); assert.equal((await put('r2', resp('r2'))).status, 422);
    como('osi'); assert.equal((await put('r3', resp('r3', { replyToId: 'q1' }))).status, 422);
  });
  await passo('OK da equipe confirma a nota da taróloga uma vez só', async () => {
    como('ate');
    const n1 = (await chamar('GET', '/notes')).j.items.find((i) => i.id === 'n1');
    const ok = { id: 'ok1', replyToId: 'n1', replySequence: 1, tarotId: '9001', tarot: 'Osíris', text: 'OK', source: 'staff', date: '2026-10-12', subject: n1.subject, startDate: n1.startDate, endDate: n1.endDate, okForId: 'n1', okForVersion: n1.updatedAt ?? n1.at, at: 'x' };
    assert.equal((await put('ok1', ok)).status, 200);
    assert.equal((await put('ok2', { ...ok, id: 'ok2' })).status, 422);
  });

  console.log('Leituras e organização pessoal');
  await passo('leitura por conta: a conta registra a dela; o autor vê quem leu; a versão errada é ignorada', async () => {
    como('sup');
    const q = (await chamar('GET', '/notes')).j.items.find((i) => i.id === 'q1');
    const lida = { ...q, readsByAccount: { [U.sup]: { at: 'x', by: 'x', version: q.updatedAt ?? q.at } } };
    const x = await put('q1', lida, 2); assert.equal(x.status, 200, x.t); assert.equal(x.j.versions.q1, 2, 'leitura não sobe a versão');
    assert.equal(x.j.items[0].readsByAccount[U.sup].by, 'Clara');
    como('ate'); const vista = (await chamar('GET', '/notes')).j.items.find((i) => i.id === 'q1');
    assert.equal(vista.readsByAccount[U.sup].by, 'Clara'); assert.equal(vista.readById, U.sup);
    como('adm'); const velha = await put('q1', { ...q, readsByAccount: { [U.adm]: { at: 'x', by: 'x', version: '2000-01-01T00:00:00.000Z' } } }, 2);
    assert.equal(velha.status, 200); assert.equal(velha.j.items[0].readsByAccount[U.adm], undefined);
  });
  await passo('fixar, prioridade e arquivar são só da conta e não pedem versão certa; a outra conta não vê', async () => {
    como('sup'); const q = (await chamar('GET', '/notes')).j.items.find((i) => i.id === 'q1');
    const x = await put('q1', { ...q, pinnedByAccount: { [U.sup]: { at: 'x' }, outra: { at: 'x' } }, prioritizedByAccount: { [U.sup]: { at: 'x' } }, archivedByAccount: { [U.sup]: { at: 'x', incomingVersions: { q1: q.updatedAt } } } }, 2);
    assert.equal(x.status, 200, x.t); assert.ok(x.j.items[0].pinnedByAccount[U.sup], JSON.stringify(x.j).slice(0, 400)); assert.equal(x.j.items[0].pinnedByAccount.outra, undefined); assert.ok(x.j.items[0].archivedByAccount[U.sup]);
    como('ate'); const vista = (await chamar('GET', '/notes')).j.items.find((i) => i.id === 'q1');
    assert.equal(vista.pinnedByAccount, undefined); assert.equal(vista.archivedByAccount, undefined);
    como('sup'); const desfaz = await put('q1', { ...x.j.items[0], pinnedByAccount: undefined }, 2);
    assert.equal(desfaz.status, 200, desfaz.t); assert.equal(desfaz.j.items[0].pinnedByAccount, undefined); assert.ok(desfaz.j.items[0].prioritizedByAccount[U.sup]);
  });
  await passo('apagar pela taróloga é remoção lógica (deletedAt) e some do conteúdo editável; importância só de quem enviou', async () => {
    como('osi');
    const n1 = (await chamar('GET', '/notes')).j.items.find((i) => i.id === 'n1');
    const del = { ...n1, deletedAt: '2026-10-12T13:00:00.000Z', updatedAt: '2026-10-12T13:00:00.000Z', revisions: [{ version: n1.updatedAt ?? n1.at, text: n1.text, at: '2026-10-12T13:00:00.000Z', by: 'x' }] };
    const x = await put('n1', del, 1); assert.equal(x.status, 200, x.t); assert.ok(x.j.items[0].deletedAt);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_recados WHERE id = 'n1' AND excluido = true"), 1);
    como('sup'); const q = (await chamar('GET', '/notes')).j.items.find((i) => i.id === 'q1');
    assert.equal((await put('q1', { ...q, importance: { byId: U.sup, at: 'x' } }, 2)).status, 422);
    como('ate'); const imp = await put('q1', { ...q, importance: { byId: U.ate, at: 'x' } }, 2); assert.equal(imp.status, 200, imp.t); assert.equal(imp.j.items[0].importance.byId, U.ate); assert.equal(imp.j.versions.q1, 3);
  });

  console.log('Corrida, auditoria, ambiente');
  await passo('duas criações simultâneas do mesmo id: uma grava, a outra é 409; nada duplicado', async () => {
    como('ate');
    const [a, b] = await Promise.all([put('c1', quadro('c1')), put('c1', quadro('c1', { text: 'Outra' }))]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_recados WHERE id = 'c1'"), 1);
  });
  await passo('cada gravação (fora a repetida) deixou auditoria na mesma transação', async () => {
    const recados = await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'recados.gravar'");
    const ops = await contar("SELECT COUNT(*) AS n FROM gf_operacoes WHERE escopo = 'recados.gravar'");
    assert.equal(recados, ops); assert.ok(recados >= 12);
  });
  await passo('dados inválidos: id diferente do caminho e corpo sem chave são 400; texto vazio é 422 com a mensagem do front', async () => {
    como('ate');
    assert.equal((await put('zz1', quadro('zz2'))).status, 400);
    assert.equal((await chamar('PUT', '/notes/zz1', { expectedVersion: 0, record: quadro('zz1') })).status, 400);
    const x = await put('zz1', quadro('zz1', { text: '  ' })); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'Mensagem: preencha este campo.');
  });
  await passo('gravação desligada é 503 e a leitura segue; fatia desligada é 404', async () => {
    como('ate');
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
    try { assert.equal((await put('d1', quadro('d1'))).status, 503); assert.equal((await chamar('GET', '/notes')).status, 200); } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
    process.env.GF_FATIA_RECADOS = 'false';
    try { assert.equal((await chamar('GET', '/notes')).status, 404); } finally { process.env.GF_FATIA_RECADOS = 'true'; }
  });
  await passo('nada novo no legado: o filho não configurou o MySQL e a tabela `recado` não é citada pela fatia', async () => {
    const fonte = require('fs').readdirSync(r('src/gestao-fadas/features/recados')).map((f) => require('fs').readFileSync(r(`src/gestao-fadas/features/recados/${f}`), 'utf8')).join('\n');
    assert.ok(!/FROM\s+recado\b|INTO\s+recado\b|UPDATE\s+recado\b/i.test(fonte));
  });


  await passo('janela opcional em GET /notes: sem parâmetros nada muda; limit/after paginam na mesma ordem, com nextCursor; parâmetro ruim é 400', async () => {
    const todas = await chamar('GET', '/notes'); assert.equal(todas.status, 200, todas.t); const n0 = todas.j.items.length; assert.ok(!('nextCursor' in todas.j), 'sem limit não há nextCursor');
    if (n0 < 2) { console.log('        (menos de 2 itens: só o contrato padrão foi conferido)'); return; }
    const p1 = await chamar('GET', '/notes?limit=1'); assert.equal(p1.status, 200, p1.t); assert.equal(p1.j.items.length, 1); assert.ok(p1.j.nextCursor, 'tem próxima página'); assert.equal(((x) => x.id)(p1.j.items[0]), ((x) => x.id)(todas.j.items[0]));
    const p2 = await chamar('GET', '/notes?limit=1&after=' + encodeURIComponent(p1.j.nextCursor)); assert.equal(p2.status, 200, p2.t); assert.equal(((x) => x.id)(p2.j.items[0]), ((x) => x.id)(todas.j.items[1]));
    const tudo = await chamar('GET', '/notes?limit=1000'); assert.equal(tudo.j.items.length, n0); assert.equal(tudo.j.nextCursor, null);
    for (const ruim of ['limit=0', 'limit=abc', 'limit=1001', 'after=nao-existe-xyz']) assert.equal((await chamar('GET', '/notes?' + ruim)).status, 400, ruim);
  });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
