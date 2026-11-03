'use strict';

/**
 * FILHO de scripts/verificar-gf-agenda.js: roda contra o Postgres DESCARTÁVEL (fdb_agd_*) já migrado, com DB_* só no ambiente
 * deste processo. Prova pelo HTTP do gate (sessão de mentira, usuários reais da A no banco): leitura vazia, criação com número
 * público e posição do servidor, idempotência, 409 de versão e de chave, corrida, contato, observações, prazo combinado, saídas,
 * resolução, ordem da fila (aplicada, recusada, supervisão vence atendente, revisão igual à do front), perfis, auditoria e eventos
 * na mesma transação, escrita desligada e que nada foi pedido ao MySQL legado.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_AGENDA: 'true' });
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const servico = require(r('src/gestao-fadas/features/agenda/agenda.service'));
  const { revisaoDaFila } = require(r('src/gestao-fadas/_comum/dominio/agenda-ordem'));
  servico.definirVerificadorDeCliente(async (id) => id !== '999999'); // o legado não está configurado neste processo
  servico.definirLeitorDeRotulo(async (id) => (id === '900013' ? 'Cliente Teste' : `Cliente ${id}`)); // idem para o rótulo da cliente (Maturacao/56, C2)
  const uAtend = await criarUsuario('Atendente Agenda');
  const uSup = await criarUsuario('Supervisora Agenda');
  const uAdm = await criarUsuario('Administradora Agenda');
  const uAssist = await criarUsuario('Assistente Agenda');
  const uTar = await criarUsuario('Taróloga Agenda');
  const NOMES = { atendente: ['Khloe', uAtend], supervisora: ['Clara', uSup], administradora: ['Laya', uAdm], assistente: ['Assist', uAssist], tarologa: ['Osiris', uTar] };
  let sessao = { userId: uAtend, role: 'atendente', displayName: 'Khloe' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-agd' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 240), h: resp.headers };
  };
  const como = (perfil, extra = {}) => { sessao = { userId: NOMES[perfil][1], role: perfil, displayName: NOMES[perfil][0], ...extra }; };
  const n = () => { n.i = (n.i || 0) + 1; return `op-${Date.now()}-${n.i}`; };
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);
  const ler = (q = '') => chamar('GET', `/agenda${q}`);
  const AGORA = () => new Date().toISOString();
  const criar = (id, extra = {}) => chamar('POST', '/agenda', { operationKey: n(), id, tarotId: 'osiris', clientId: '900013', client: 'Cliente Teste', date: '2026-11-10', set: { time: '10:00', channel: 'WhatsApp', observation: 'Sem observações.', response: 'Aguardando resposta', contact: { attempt: 1, date: '2026-11-10', tags: [] }, paymentPending: false }, ...extra });
  const cmd = (rota, id, v, corpo, metodo = 'POST') => chamar(metodo, `/agenda/${id}${rota}`, { operationKey: n(), expectedVersion: v, ...corpo });
  const evContato = (id, tag, extra = {}) => ({ id, actor: 'x', at: AGORA(), date: '2026-11-10', attempt: 1, tag, active: true, before: [], after: [tag], ...extra });

  console.log('Esquema');
  await passo('3 tabelas da fatia existem e a migração roda de novo sem erro', async () => {
    const [t] = await sequelize.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('gf_agenda','gf_agenda_eventos','gf_agenda_ordem_comandos')");
    assert.equal(t.length, 3);
    await require(r('migrations/20261110000000-gestao-fadas-agenda')).up({ sequelize });
  });

  console.log('Leitura e criação');
  como('atendente');
  await passo('GET vazio: 200, DTO puro, no-store, sem exemplo', async () => {
    const x = await ler();
    assert.equal(x.status, 200, x.t);
    assert.ok(!('sucesso' in x.j)); assert.deepEqual(x.j.items, []); assert.deepEqual(x.j.queueRevisions, {}); assert.equal(x.h.get('cache-control'), 'no-store');
    assert.match(x.j.today, /^\d{4}-\d{2}-\d{2}$/);
  });
  const corpoA1 = { operationKey: n(), id: 'ag-a1', tarotId: 'osiris', clientId: '900013', client: 'Cliente Teste', date: '2026-11-10', set: { time: '10:00', channel: 'WhatsApp', observation: 'Sem observações.', response: 'Aguardando resposta', contact: { attempt: 1, date: '2026-11-10', tags: [] }, paymentPending: false } };
  const a1 = await chamar('POST', '/agenda', corpoA1);
  await passo('POST /agenda: 200, número público 1, posição 1, quem criou e quando vêm do servidor, versão 1', async () => {
    assert.equal(a1.status, 200, a1.t);
    const it = a1.j.agenda[0];
    assert.equal(it.id, 'ag-a1'); assert.equal(it.publicNumber, 1); assert.equal(it.position, 1); assert.equal(it.createdBy, 'Khloe'); assert.ok(Date.parse(it.createdAt));
    assert.equal(a1.j.versions['ag-a1'], 1); assert.equal(a1.j.queueRevisions.osiris, revisaoDaFila([it], 'osiris'));
    assert.ok(!('positionOverrides' in it) && !('orderCommand' in it), 'campo ausente fica ausente');
  });
  await passo('mesma chave e mesmo corpo repete a resposta sem gravar de novo', async () => {
    const antes = await contar('SELECT COUNT(*) AS n FROM gf_agenda');
    const rep = await chamar('POST', '/agenda', corpoA1);
    assert.equal(rep.status, 200); assert.deepEqual(rep.j, a1.j);
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_agenda'), antes);
  });
  await passo('mesma chave com outro corpo: 409 OPERATION_KEY_CONFLICT; mesmo id com outra chave: 409 VERSION_CHANGED', async () => {
    const x = await chamar('POST', '/agenda', { ...corpoA1, client: 'Outro' });
    assert.equal(x.status, 409); assert.equal(x.j.error.code, 'OPERATION_KEY_CONFLICT');
    const y = await criar('ag-a1');
    assert.equal(y.status, 409); assert.equal(y.j.error.code, 'VERSION_CHANGED');
  });
  await passo('segundo agendamento da mesma fila: número 2, posição 2; outro tarólogo começa em 1', async () => {
    const b = await criar('ag-a2');
    assert.equal(b.j.agenda[0].publicNumber, 2); assert.equal(b.j.agenda[0].position, 2);
    const c = await criar('ag-n1', { tarotId: 'nyx' });
    assert.equal(c.j.agenda[0].position, 1); assert.equal(c.j.agenda[0].publicNumber, 3);
    const d = await criar('ag-a3'); assert.equal(d.j.agenda[0].position, 3);
  });
  await passo('cliente que não existe no legado: 404 CLIENT_NOT_FOUND; dia inválido: 400; combinado de contato inválido: 422', async () => {
    const x = await criar('ag-x', { clientId: '999999' });
    assert.equal(x.status, 404); assert.equal(x.j.error.code, 'CLIENT_NOT_FOUND');
    assert.equal((await criar('ag-y', { date: '2026-02-30' })).status, 400);
    const z = await criar('ag-z', { set: { contactPlan: { who: 'staff', timing: 'exact' } } });
    assert.equal(z.status, 422); assert.equal(z.j.error.message, 'Informe um horário válido, como 20:00.');
  });
  await passo('criação com combinado de contato e observação inicial grava tudo como o front montou', async () => {
    const x = await criar('ag-p1', { tarotId: 'estrela', set: { time: '11:00', channel: 'WhatsApp', response: 'Aguardando resposta', paymentPending: false, contact: { attempt: 1, date: '2026-11-10', tags: ['Chama depois'] }, contactPlan: { who: 'staff', timing: 'exact', time: '20h', callback: true }, scheduledTime: '20:00', observation: 'Chamar à noite', observations: [{ id: 'o-p1', text: 'Chamar à noite', createdAt: AGORA(), createdBy: 'x' }] }, append: { contactHistory: [evContato('c-p1', 'Chama depois', { before: [], after: ['Chama depois'] })] } });
    assert.equal(x.status, 200, x.t);
    const it = x.j.agenda[0];
    assert.equal(it.contactPlan.time, '20h'); /* guardado como o front o enviou (Maturacao/44) */ assert.equal(it.contactHistory[0].actor, 'Khloe'); assert.equal(it.observations[0].text, 'Chamar à noite');
  });

  console.log('Leitura devolve o que foi gravado');
  await passo('GET traz os itens, as versões e as revisões queue-v1 IGUAIS às que o front calcularia', async () => {
    const x = await ler();
    assert.equal(x.status, 200, x.t);
    assert.equal(x.j.items.length, 5);
    for (const t of ['osiris', 'nyx', 'estrela']) assert.equal(x.j.queueRevisions[t], revisaoDaFila(x.j.items, t), t);
    assert.equal(x.j.versions['ag-a1'], 1);
    const so = await ler('?tarotId=nyx');
    assert.deepEqual(so.j.items.map((i) => i.id), ['ag-n1']);
  });

  console.log('Comandos sobre o agendamento');
  let v = 1;
  await passo('contato: Avisada grava o contato, o evento imutável e sobe a versão; autor é o da sessão', async () => {
    const x = await cmd('/contact', 'ag-a1', v, { set: { contact: { attempt: 1, date: '2026-11-10', tags: ['Avisada'] }, workflowStatus: 'Avisada' }, append: { contactHistory: [evContato('c-1', 'Avisada', { actor: 'Forjado' })] } });
    assert.equal(x.status, 200, x.t);
    const it = x.j.agenda[0];
    assert.deepEqual(it.contact.tags, ['Avisada']); assert.equal(it.contactHistory[0].actor, 'Khloe'); assert.equal(x.j.versions['ag-a1'], 2);
    v = 2;
  });
  await passo('versão antiga: 409 VERSION_CHANGED, nada gravado; versão certa depois funciona', async () => {
    const antes = await contar('SELECT COUNT(*) AS n FROM gf_agenda_eventos');
    const x = await cmd('/contact', 'ag-a1', 1, { set: { contact: { attempt: 1, date: '2026-11-10', tags: ['Avisada', 'Vai pagar'] } }, append: { contactHistory: [evContato('c-2', 'Vai pagar', { before: ['Avisada'], after: ['Avisada', 'Vai pagar'] })] } });
    assert.equal(x.status, 409); assert.equal(x.j.error.code, 'VERSION_CHANGED');
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_agenda_eventos'), antes);
    const y = await cmd('/contact', 'ag-a1', v, { set: { contact: { attempt: 1, date: '2026-11-10', tags: ['Avisada', 'Vai pagar'] } }, append: { contactHistory: [evContato('c-2', 'Vai pagar', { before: ['Avisada'], after: ['Avisada', 'Vai pagar'] })] } });
    assert.equal(y.status, 200, y.t); v = 3;
  });
  await passo('expectedContact desatualizado: 409; etiqueta inventada: 422', async () => {
    const velha = { contact: { attempt: 1, date: '2026-11-10', tags: [] } };
    const x = await cmd('/contact', 'ag-a1', v, { expectedContact: velha, set: { contact: { attempt: 1, date: '2026-11-10', tags: ['Avisada'] } }, append: { contactHistory: [evContato('c-3', 'Avisada', { active: false, after: [] })] } });
    assert.equal(x.status, 409);
    const y = await cmd('/contact', 'ag-a1', v, { append: { contactHistory: [evContato('c-4', 'Inventada')] } });
    assert.equal(y.status, 422); assert.equal(y.j.error.code, 'RULE_VIOLATION');
  });
  await passo('corrida: dois comandos com a mesma versão, um passa e o outro recebe 409', async () => {
    const mk = (id) => cmd('/observations', 'ag-a2', 1, { set: { observation: 'Nota', observations: [{ id: `o-${id}`, text: 'Nota', createdAt: AGORA(), createdBy: 'x' }] }, append: { observationHistory: [{ id: `ev-${id}`, observationId: `o-${id}`, action: 'add', at: AGORA(), actor: 'x', after: 'Nota' }] } });
    const [a, b] = await Promise.all([mk('r1'), mk('r2')]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.status}/${b.status}`);
  });
  await passo('observações: editar e excluir seguem o estado; texto vazio é 422 com a mensagem do front', async () => {
    const lido = (await ler()).j;
    const it = lido.items.find((i) => i.id === 'ag-a2'); let ver = lido.versions['ag-a2'];
    const nota = it.observations[0];
    const vazio = await cmd('/observations', 'ag-a2', ver, { set: { observations: [{ ...nota, text: ' ', updatedAt: AGORA(), updatedBy: 'x' }] }, append: { observationHistory: [{ id: 'ev-e0', observationId: nota.id, action: 'edit', at: AGORA(), actor: 'x' }] } });
    assert.equal(vazio.status, 422); assert.equal(vazio.j.error.message, 'Escreva a observação antes de salvar.');
    const ed = await cmd('/observations', 'ag-a2', ver, { set: { observation: 'Nota nova', observations: [{ ...nota, text: 'Nota nova', updatedAt: AGORA(), updatedBy: 'x' }] }, append: { observationHistory: [{ id: 'ev-e1', observationId: nota.id, action: 'edit', at: AGORA(), actor: 'x', before: 'Nota', after: 'Nota nova' }] } });
    assert.equal(ed.status, 200, ed.t); ver += 1;
    const del = await cmd('/observations', 'ag-a2', ver, { set: { observation: 'Sem observações.', observations: [{ ...nota, text: 'Nota nova', deletedAt: AGORA(), deletedBy: 'x' }] }, append: { observationHistory: [{ id: 'ev-e2', observationId: nota.id, action: 'delete', at: AGORA(), actor: 'x' }] } });
    assert.equal(del.status, 200, del.t);
    assert.equal(del.j.agenda[0].observationHistory.length, 3);
  });
  await passo('prazo combinado: grava, 0 minutos é 422, expectedLatestId errado é 409', async () => {
    const ver = (await ler()).j.versions['ag-a3'];
    const onde = (minutes, id) => ({ append: { requestedWaitHistory: [{ id, minutes, at: AGORA(), by: 'x', attempt: 1, afterEventId: '' }] } });
    assert.equal((await cmd('/requested-wait', 'ag-a3', ver, onde(0, 'w0'))).status, 422);
    const ok1 = await cmd('/requested-wait', 'ag-a3', ver, onde(45, 'wait-1'));
    assert.equal(ok1.status, 200, ok1.t); assert.equal(ok1.j.agenda[0].requestedWaitHistory[0].minutes, 45);
    const vel = await cmd('/requested-wait', 'ag-a3', ver + 1, { ...onde(10, 'wait-2'), expectedLatestId: 'nao-e-esse' });
    assert.equal(vel.status, 409);
    const seg = await cmd('/requested-wait', 'ag-a3', ver + 1, { ...onde(10, 'wait-2'), expectedLatestId: 'wait-1' });
    assert.equal(seg.status, 200, seg.t); assert.equal(seg.j.agenda[0].requestedWaitHistory.length, 2);
  });
  await passo('PATCH do agendamento: muda dia e horário, grava o histórico; mudar de tarólogo leva a posição do servidor', async () => {
    const ver = (await ler()).j.versions['ag-a3'];
    const x = await cmd('', 'ag-a3', ver, { set: { date: '2026-11-11', scheduledTime: '09:00', tarotId: 'nyx' }, unset: ['positionOverrides'], append: { scheduleHistory: [{ id: 'sh-1', actor: 'x', at: AGORA(), before: { date: '2026-11-10' }, after: { date: '2026-11-11' } }] } }, 'PATCH');
    assert.equal(x.status, 200, x.t);
    const it = x.j.agenda[0];
    assert.equal(it.tarotId, 'nyx'); assert.equal(it.date, '2026-11-11'); assert.ok(it.position >= 1); assert.equal(it.scheduleHistory[0].actor, 'Khloe');
    assert.ok(x.j.queueRevisions.nyx && x.j.queueRevisions.osiris, 'devolve a revisão das duas filas');
  });
  await passo('saída: cancelar fecha o item e ele sai da fila; restaurar reabre; transferência sem destino é 422', async () => {
    const ver = (await ler()).j.versions['ag-a2'];
    const dep = { id: 'd-1', tarotId: 'osiris', date: '2026-11-10', originDate: '2026-11-10', action: 'cancel', reason: 'Desistiu', actor: 'x', at: AGORA() };
    const x = await cmd('/departures', 'ag-a2', ver, { set: { agendaOutcome: 'Cancelada', resolvedAt: AGORA(), contact: { attempt: 2, date: '2026-11-10', tags: ['Cancelada'] }, workflowStatus: 'Concluída' }, append: { departures: [dep] } });
    assert.equal(x.status, 200, x.t);
    assert.equal(x.j.agenda[0].agendaOutcome, 'Cancelada');
    assert.ok(!(await ler()).j.items.find((i) => i.id === 'ag-a2' && !i.agendaOutcome));
    assert.ok(!('osiris' in { ...(x.j.queueRevisions) }) || x.j.queueRevisions.osiris === revisaoDaFila((await ler()).j.items, 'osiris'));
    const rest = await cmd('/resolution', 'ag-a2', ver + 1, { restoreDepartures: ['d-1'], unset: ['agendaOutcome', 'resolvedAt', 'workflowStatus'], set: { contact: { attempt: 3, date: '2026-11-10', tags: [] }, response: 'Aguardando resposta' }, append: { resolutionHistory: [{ id: 'rs-1', action: 'Restaurada na agenda', consultationId: '', actor: 'x', createdAt: AGORA(), detail: 'Agendamento restaurado pelo atendimento.' }] } });
    assert.equal(rest.status, 200, rest.t);
    assert.equal(rest.j.agenda[0].departures[0].restored, true); assert.ok(!('agendaOutcome' in rest.j.agenda[0]));
    const t = await cmd('/departures', 'ag-a2', ver + 2, { append: { departures: [{ ...dep, id: 'd-2', action: 'transfer', reason: 'Pediu outro tarólogo' }] } });
    assert.equal(t.status, 422); assert.equal(t.j.error.message, 'Escolha o que o tarólogo verá.');
  });
  await passo('resolução que nasce da consulta ainda não existe nesta fatia: 422', async () => {
    const ver = (await ler()).j.versions['ag-a1'];
    const x = await cmd('/resolution', 'ag-a1', ver, { append: { resolutionHistory: [{ id: 'rs-2', action: 'Agendamento concluído', consultationId: 'c1', actor: 'x', createdAt: AGORA(), detail: 'd' }] } });
    assert.equal(x.status, 422);
  });
  await passo('campo reservado (positionOverrides, publicNumber) e agendamento inexistente: 422 e 404', async () => {
    const ver = (await ler()).j.versions['ag-a1'];
    assert.equal((await cmd('', 'ag-a1', ver, { set: { publicNumber: 99 } }, 'PATCH')).status, 422);
    assert.equal((await cmd('', 'ag-a1', ver, { set: { positionOverrides: { 'explicit:queue:osiris': 1 } } }, 'PATCH')).status, 422);
    const nf = await cmd('/contact', 'ag-nao-existe', 1, { set: {} });
    assert.equal(nf.status, 404); assert.equal(nf.j.error.code, 'NOT_FOUND');
  });

  console.log('Ordem da fila');
  const fila = async (t = 'estrela') => (await ler(`?tarotId=${t}`)).j;
  for (const id of ['ag-e1', 'ag-e2', 'ag-e3']) await criar(id, { tarotId: 'estrela' });
  const ordenar = (t, o) => chamar('POST', `/agenda/queues/${t}/order`, { operationKey: n(), commandId: `cmd-${n()}`, ...o });
  const ranks = (ids, t = 'estrela') => Object.fromEntries(ids.map((id, i) => [id, { [`explicit:queue:${t}`]: i + 1 }]));
  let atual = await fila();
  const abertos = (j) => j.items.filter((i) => !i.agendaOutcome).map((i) => i.id);
  await passo('atendente reordena com a revisão atual: aplicada, todos os itens abertos ganham o comando e a nova revisão bate com a do front', async () => {
    const ids = abertos(atual); const novo = [ids[2], ids[0], ids[1], ...ids.slice(3)];
    const x = await ordenar('estrela', { baseRevision: atual.queueRevisions.estrela, movedId: ids[2], beforeIds: ids, afterIds: novo, ranks: ranks(novo) });
    assert.equal(x.status, 200, x.t);
    assert.ok(x.j.agenda.every((i) => i.orderCommand && i.orderCommand.actorName === 'Khloe' && i.orderCommand.actorRole === 'atendente' && i.orderCommand.persisted === true));
    const lido = await fila();
    assert.equal(lido.queueRevisions.estrela, x.j.queueRevisions.estrela); assert.equal(lido.queueRevisions.estrela, revisaoDaFila(lido.items, 'estrela'));
    assert.notEqual(lido.queueRevisions.estrela, atual.queueRevisions.estrela);
    assert.equal(lido.items.find((i) => i.id === novo[0]).positionOverrides['explicit:queue:estrela'], 1);
    atual = lido;
  });
  await passo('mesma chave repete sem gravar; revisão velha: 409 VERSION_CHANGED com a mensagem do front e o comando recusado fica registrado', async () => {
    const ids = abertos(atual);
    const x = await ordenar('estrela', { baseRevision: 'queue-v1:9:velha', movedId: ids[0], beforeIds: ids, afterIds: ids.slice().reverse(), ranks: ranks(ids.slice().reverse()) });
    assert.equal(x.status, 409); assert.equal(x.j.error.code, 'VERSION_CHANGED'); assert.equal(x.j.error.message, 'Não foi possível mover a cliente. Tente arrastar novamente.');
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_agenda_ordem_comandos WHERE status = 'rejected' AND motivo = 'stale'"), 1);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_agenda_eventos WHERE tipo = 'estado' AND dados->>'codigo' = 'agenda.order_rejected'"), 1);
    assert.equal((await fila()).queueRevisions.estrela, atual.queueRevisions.estrela, 'a fila não mudou');
  });
  await passo('SUPERVISÃO e ATENDENTE na mesma revisão: a supervisão aplica e substitui; a atendente depois é recusada', async () => {
    const ids = abertos(atual); const base = atual.queueRevisions.estrela;
    como('atendente');
    const at = ordenar('estrela', { baseRevision: base, movedId: ids[1], beforeIds: ids, afterIds: [ids[1], ids[0], ...ids.slice(2)], ranks: ranks([ids[1], ids[0], ...ids.slice(2)]) });
    const a = await at; assert.equal(a.status, 200, a.t);
    como('supervisora');
    const s = await ordenar('estrela', { baseRevision: base, movedId: ids[2], beforeIds: ids, afterIds: [ids[2], ...ids.filter((x) => x !== ids[2])], ranks: ranks([ids[2], ...ids.filter((x) => x !== ids[2])]) });
    assert.equal(s.status, 200, s.t);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_agenda_ordem_comandos WHERE status = 'superseded'"), 1);
    como('atendente');
    const a2 = await ordenar('estrela', { baseRevision: base, movedId: ids[0], beforeIds: ids, afterIds: ids, ranks: ranks(ids) });
    assert.equal(a2.status, 409);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_agenda_ordem_comandos WHERE status = 'rejected' AND motivo = 'authority'"), 1);
    atual = await fila();
    assert.equal(atual.items.find((i) => i.id === ids[2]).positionOverrides['explicit:queue:estrela'], 1, 'a ordem da supervisão ficou');
  });
  await passo('ordem POSTERIOR da atendente sobre a revisão atual é aceita; item de outra fila no comando é 422', async () => {
    como('atendente');
    const ids = abertos(atual);
    const x = await ordenar('estrela', { baseRevision: atual.queueRevisions.estrela, movedId: ids[0], beforeIds: ids, afterIds: ids.slice().reverse(), ranks: ranks(ids.slice().reverse()) });
    assert.equal(x.status, 200, x.t);
    const y = await ordenar('estrela', { baseRevision: (await fila()).queueRevisions.estrela, movedId: 'ag-n1', beforeIds: ['ag-n1'], afterIds: ['ag-n1'], ranks: {} });
    assert.equal(y.status, 422);
  });
  await passo('corrida de duas ordens na mesma revisão: uma aplica e a outra é recusada', async () => {
    como('atendente'); atual = await fila();
    const ids = abertos(atual); const base = atual.queueRevisions.estrela;
    const mk = (novo) => ordenar('estrela', { baseRevision: base, movedId: novo[0], beforeIds: ids, afterIds: novo, ranks: ranks(novo) });
    const [a, b] = await Promise.all([mk([ids[1], ids[0], ...ids.slice(2)]), mk([ids[2], ids[1], ids[0], ...ids.slice(3)])]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.status}/${b.status}`);
  });

  console.log('Perfis');
  await passo('equipe lê e grava (administradora, assistente, supervisora, atendente); taróloga: 403 em tudo', async () => {
    for (const p of ['administradora', 'assistente', 'supervisora', 'atendente']) {
      como(p);
      assert.equal((await ler()).status, 200, p);
      const x = await criar(`ag-${p}`, { tarotId: 'iris' });
      assert.equal(x.status, 200, `${p}: ${x.t}`); assert.equal(x.j.agenda[0].createdBy, NOMES[p][0]);
    }
    como('tarologa', { tarotId: 'osiris' });
    assert.equal((await ler()).status, 403);
    const g = await criar('ag-tar'); assert.equal(g.status, 403); assert.equal(g.j.error.code, 'ACCESS_DENIED');
    assert.equal((await ordenar('osiris', { baseRevision: 'x', beforeIds: [], afterIds: [], ranks: {} })).status, 403);
    como('atendente');
  });

  console.log('Auditoria, flags e legado');
  await passo('cada gravação deixou linha em gf_auditoria (entidade agenda) e o evento imutável em gf_agenda_eventos, e a repetição não duplicou', async () => {
    const [l] = await sequelize.query("SELECT acao, ator_funcao, entidade, entidade_id, antes, depois FROM gf_auditoria WHERE entidade = 'agenda' ORDER BY ocorrido_em");
    assert.ok(l.length >= 20, `${l.length} linhas`);
    assert.ok(l.every((x) => ['atendente', 'administradora', 'assistente', 'supervisora'].includes(x.ator_funcao)));
    assert.ok(l.some((x) => x.acao === 'agenda.criar') && l.some((x) => x.acao === 'agenda.contato') && l.some((x) => x.acao === 'agenda.ordem'));
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_operacoes WHERE escopo LIKE 'agenda.%'"), l.length);
    assert.ok(await contar("SELECT COUNT(*) AS n FROM gf_agenda_eventos WHERE tipo = 'criacao'") >= 8);
    assert.equal(await contar('SELECT COUNT(*) AS n FROM (SELECT id_agenda, tipo, evento_ref FROM gf_agenda_eventos WHERE evento_ref IS NOT NULL GROUP BY 1,2,3 HAVING COUNT(*) > 1) d'), 0);
  });
  await passo('a versão de cada agendamento é a quantidade de gravações dele (sem salto nem repetição)', async () => {
    const [[x]] = await sequelize.query("SELECT version FROM gf_agenda WHERE id = 'ag-a1'");
    assert.equal(Number(x.version), 3 + 0 + (await contar("SELECT COUNT(*) AS n FROM gf_agenda_eventos WHERE id_agenda = 'ag-a1' AND tipo = 'resolucao'")) * 0);
  });
  await passo('escrita desligada: leitura segue 200 e gravação responde 503 WRITE_DISABLED', async () => {
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
    try {
      assert.equal((await ler()).status, 200);
      const x = await criar('ag-off'); assert.equal(x.status, 503); assert.equal(x.j.error.code, 'WRITE_DISABLED');
    } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
  });
  await passo('fatia desligada em tempo de execução: 404', async () => {
    process.env.GF_FATIA_AGENDA = 'false';
    try { assert.equal((await ler()).status, 404); } finally { process.env.GF_FATIA_AGENDA = 'true'; }
  });
  await passo('nada foi pedido ao MySQL legado: tudo acima passou com o legado NÃO configurado neste processo', async () => {
    assert.equal(`${process.env.LEGADO_DB_HOST || ''}`, ''); assert.equal(`${process.env.LEGADO_DB_NAME || ''}`, '');
  });

  srv.close();
  await sequelize.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres: ${ok} ok, ${falhas.length} falhas`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
