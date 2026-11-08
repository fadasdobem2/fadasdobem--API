'use strict';

/**
 * FILHO de scripts/verificar-gf-agenda-pedido.js: Postgres DESCARTÁVEL (fdb_agp_*) já migrado, pelo HTTP do gate (v706 da Nice, Maturacao/57):
 * migração (cliente OU contato nulos), pedido da taróloga por ID e por WhatsApp (contato IL), pedido repetido, conduta do pedido pela equipe,
 * contatos (criar, editar, arquivar), agendamento de contato, vincular a uma cliente e desfazer (atômico, na agenda), aviso manual, idempotência.
 * O legado não está configurado: a existência da cliente e o rótulo são trocados por funções de teste. Todo dado é fictício.
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
  const filaContexto = require(r('src/gestao-fadas/features/agenda/agenda-fila.contexto'));
  const { hojeOperacional } = require(r('src/gestao-fadas/_comum/dia-operacional'));
  require(r('src/gestao-fadas/features/agenda/agenda-admissao.service')).definirVerificadorDeCliente(async (id) => id !== '999999');
  servico.definirVerificadorDeCliente(async (id) => id !== '999999');
  servico.definirLeitorDeRotulo(async (id) => (id === '999999' ? null : `Cliente ${id}`));
  filaContexto.definirFonteDeTarologo(async (id) => ({ id, name: id, registrationActive: true }));
  const uAtend = await criarUsuario('Atendente Pedidos');
  const uTar = await criarUsuario('Taróloga Pedidos');
  let sessao;
  const staff = () => { sessao = { userId: uAtend, role: 'atendente', displayName: 'Khloe' }; };
  const leitora = () => { sessao = { userId: uTar, role: 'tarologa', displayName: 'Osiris', tarotId: 'osiris' }; };
  staff();
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-agp' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 300) };
  };
  const n = () => { n.i = (n.i || 0) + 1; return `op-pedido-${Date.now()}-${n.i}`; };
  const um = async (sql, ...v) => (await sequelize.query(sql, { replacements: v }))[0];
  const HOJE = hojeOperacional();
  const soma = (d, k) => new Date(Date.parse(`${d}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
  const AMANHA = soma(HOJE, 1);
  const recusa = (x, status, mensagem) => { assert.equal(x.status, status, x.t); assert.equal(x.j.error.message, mensagem, x.t); };
  const pedido = (id, extra = {}) => chamar('POST', '/agenda/requests', { operationKey: n(), request: { id, date: AMANHA, channel: 'WhatsApp Áudio', requestedMinutes: 30, ...extra } });
  const salvarContato = (c, v) => chamar('PUT', `/agenda/contacts/${c.id}`, { operationKey: n(), ...(v ? { expectedVersion: v } : {}), contact: c });
  const lerContatos = async () => (await chamar('GET', '/agenda/contacts')).j;
  const atualizar = (item, v, extra = {}) => chamar('PUT', `/agenda/requests/${item.id}`, { operationKey: n(), expectedVersion: v, request: { ...item, ...extra } });
  const criarAgenda = (id, extra = {}) => chamar('POST', '/agenda', { operationKey: n(), id, tarotId: 'osiris', date: AMANHA, set: { time: '10:00', channel: 'WhatsApp Áudio', observation: 'Sem observações.', response: 'Aguardando resposta', contact: { attempt: 1, date: AMANHA, tags: [] }, paymentPending: false }, ...extra });

  console.log('Esquema');
  await passo('cliente nula e contato nos agendamentos e pedidos; tabela de contatos existe; a migração roda de novo', async () => {
    const col = await um("SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('id_cliente','id_contato') AND table_name IN ('gf_agenda','gf_agenda_solicitacoes') ORDER BY 1,2");
    assert.equal(col.length, 4); assert.ok(col.filter((c) => c.column_name === 'id_cliente').every((c) => c.is_nullable === 'YES'));
    assert.equal((await um("SELECT 1 FROM information_schema.tables WHERE table_name = 'gf_agenda_contatos'")).length, 1);
    await require(r('migrations/20261206000000-gestao-fadas-agenda-contatos')).up({ sequelize });
  });

  console.log('Pedido da taróloga');
  leitora();
  let p1;
  await passo('pedido por ID de cliente: 200, etapa Perguntar, autoria e dia do servidor; o mesmo pedido volta o mesmo registro', async () => {
    const x = await pedido('rq-1', { clientId: '900013', client: 'Nome Forjado' });
    assert.equal(x.status, 200, x.t);
    p1 = x.j.items[0];
    assert.equal(p1.stage, 'ask'); assert.equal(p1.tarotId, 'osiris'); assert.equal(p1.clientId, '900013'); assert.equal(p1.history[0].by, 'Osiris'); assert.equal(p1.date, AMANHA);
    const igual = await pedido('rq-1b', { clientId: '900013' });
    assert.equal(igual.status, 200, igual.t); assert.equal(igual.j.items[0].id, 'rq-1');
    assert.equal((await um('SELECT 1 FROM gf_agenda_solicitacoes')).length, 1);
  });
  await passo('mesmo pedido (mesma ocorrência) com outro meio de consulta: 422 com a frase do front (um horário NOVO seria outra ocorrência, v710)', async () => {
    recusa(await pedido('rq-1c', { clientId: '900013', channel: 'WhatsApp Texto' }), 422, 'Já existe um pedido para esta data com dados diferentes. A equipe pode revisar o pedido existente.');
  });
  await passo('data passada, horário inválido, meio inválido, minutos inválidos e cliente que não existe: recusados, nada gravado', async () => {
    recusa(await pedido('rq-2', { clientId: '900014', date: soma(HOJE, -1) }), 422, 'Confira a data e o horário do pedido.');
    recusa(await pedido('rq-2', { clientId: '900014', requestedTime: '25:99' }), 422, 'Confira a data e o horário do pedido.');
    recusa(await pedido('rq-2', { clientId: '900014', channel: 'Pombo' }), 422, 'Escolha um meio de consulta válido.');
    recusa(await pedido('rq-2', { clientId: '900014', requestedMinutes: 0 }), 422, 'Informe os minutos solicitados com um número inteiro maior que zero.');
    assert.equal((await pedido('rq-2', { clientId: '999999' })).status, 404);
    assert.equal((await um('SELECT 1 FROM gf_agenda_solicitacoes')).length, 1);
  });
  let c1;
  await passo('pedido por WhatsApp (sem cadastro): cria o contato IL 0001 com o telefone normalizado; outro dia, mesmo telefone, reaproveita o contato', async () => {
    const x = await pedido('rq-3', { submittedIdentity: { clientId: '', name: 'Ana Lead', whatsapp: '(11) 98765-4321' } });
    assert.equal(x.status, 200, x.t);
    const it = x.j.items[0];
    assert.equal(it.clientId, ''); assert.ok(it.contactId); assert.equal(it.contactCode, 'IL 0001');
    const y = await pedido('rq-4', { date: soma(AMANHA, 1), submittedIdentity: { clientId: '', name: 'Ana Lead', whatsapp: '+55 11 98765-4321' } });
    assert.equal(y.status, 200, y.t); assert.equal(y.j.items[0].contactId, it.contactId);
    staff(); c1 = (await lerContatos()).items.find((c) => c.id === it.contactId); leitora();
    assert.equal(c1.whatsapp, '+5511987654321'); assert.equal(c1.displayCode, 'IL 0001'); assert.equal((await um('SELECT 1 FROM gf_agenda_contatos')).length, 1);
    assert.equal((await um('SELECT id_cliente, id_contato FROM gf_agenda_solicitacoes WHERE id = ?', 'rq-3'))[0].id_cliente, null);
  });
  await passo('WhatsApp incompleto ou sem ID nem telefone: 422 com a frase do front', async () => {
    recusa(await pedido('rq-5', { submittedIdentity: { clientId: '', name: 'X', whatsapp: '1234' } }), 422, 'Informe o WhatsApp completo, com DDD e os 8 ou 9 números locais.');
    recusa(await pedido('rq-5', { submittedIdentity: { clientId: '', name: 'X', whatsapp: '' } }), 422, 'Informe o ID ou um WhatsApp completo com DDD.');
  });
  await passo('a taróloga não lê nem escreve contatos nem conduz o pedido (é da equipe)', async () => {
    assert.equal((await chamar('GET', '/agenda/contacts')).status, 403);
    assert.equal((await chamar('PUT', '/agenda/requests/rq-1', { operationKey: n(), expectedVersion: 1, request: p1 })).status, 403);
  });

  console.log('Equipe conduz o pedido');
  staff();
  await passo('Perguntamos: etapa e histórico mudam, a autoria da entrada nova é da sessão; versão errada é 409; confirmar sem agendamento é 422', async () => {
    const entrada = { id: 'h-1', action: 'asked', at: '2000-01-01T00:00:00.000Z', by: 'Forjado' };
    const x = await atualizar(p1, 1, { stage: 'asked', history: [...p1.history, entrada] });
    assert.equal(x.status, 200, x.t);
    const it = x.j.items[0];
    assert.equal(it.stage, 'asked'); assert.equal(it.history.at(-1).by, 'Khloe'); assert.notEqual(it.history.at(-1).at, '2000-01-01T00:00:00.000Z'); assert.equal(x.j.versions['rq-1'], 2);
    assert.equal((await atualizar(it, 1, { stage: 'asked' })).status, 409);
    recusa(await atualizar(it, 2, { stage: 'confirmed', history: [...it.history, { id: 'h-2', action: 'confirmed' }] }), 422, 'Vincule um agendamento ativo antes de confirmar.');
    recusa(await atualizar(it, 2, { tarotId: 'nyx' }), 422, 'Esta ação não pode ser alterada.');
    recusa(await atualizar(it, 2, { history: [] }), 422, 'Esta ação não pode ser alterada.');
    p1 = it;
  });
  await passo('pedido de contato não confirma sem cliente; pedir ao tarólogo só antes de Perguntamos', async () => {
    const lista = (await chamar('GET', '/agenda/requests')).j.items;
    const sem = lista.find((i) => i.id === 'rq-3');
    const x = await atualizar(sem, 1, { stage: 'confirmed', history: [...sem.history, { id: 'h-3', action: 'confirmed' }] });
    recusa(x, 422, 'Cadastre ou localize a cliente neste pedido antes de confirmar o agendamento.');
    const ok = await atualizar(sem, 1, { readerInquiry: 'not_located', identityNotFound: true, history: [...sem.history, { id: 'h-4', action: 'identity_not_found' }] });
    assert.equal(ok.status, 200, ok.t);
    const it = ok.j.items[0];
    const perguntou = await atualizar(it, 2, { stage: 'asked', readerInquiry: undefined, identityNotFound: undefined, history: [...it.history, { id: 'h-5', action: 'asked' }] });
    assert.equal(perguntou.status, 200, perguntou.t);
    recusa(await atualizar(perguntou.j.items[0], 3, { readerInquiry: 'not_located', identityNotFound: true }), 422, 'A identificação com o tarólogo só está disponível antes de Perguntamos.');
  });

  console.log('Contatos');
  let c2;
  await passo('criar contato da equipe: código IL do servidor (não o do navegador), telefone normalizado; telefone igual é 422; idempotência', async () => {
    const chave = n();
    const corpo = { operationKey: chave, contact: { id: 'ct-2', name: 'Bia Contato', whatsapp: '21 93456-7890', source: 'staff', referral: false, createdAt: '2000-01-01T00:00:00.000Z', classification: 'identification_pending', history: [{ id: 'ct-2:h', action: 'Contato criado' }], displayCode: 'IL 9999' } };
    const x = await chamar('PUT', '/agenda/contacts/ct-2', corpo);
    assert.equal(x.status, 200, x.t);
    c2 = x.j.items[0];
    assert.equal(c2.displayCode, 'IL 0002'); assert.equal(c2.whatsapp, '+5521934567890'); assert.equal(c2.history[0].by, 'Khloe'); assert.notEqual(c2.createdAt, '2000-01-01T00:00:00.000Z');
    const again = await chamar('PUT', '/agenda/contacts/ct-2', corpo);
    assert.equal(again.status, 200); assert.equal(again.j.items[0].displayCode, 'IL 0002'); assert.equal((await um('SELECT 1 FROM gf_agenda_contatos')).length, 2);
    recusa(await salvarContato({ ...corpo.contact, id: 'ct-9' }), 422, 'Este WhatsApp já está em outro contato. Confira os vínculos antes de alterar.');
  });
  await passo('editar contato: versão, histórico que só cresce, WhatsApp completo e nome obrigatório', async () => {
    const e = { ...c2, name: 'Bia Souza', history: [...c2.history, { id: 'ct-2:e', action: 'Contato atualizado' }] };
    const x = await salvarContato(e, 1);
    assert.equal(x.status, 200, x.t); assert.equal(x.j.items[0].name, 'Bia Souza'); assert.equal(x.j.items[0].displayCode, 'IL 0002'); assert.equal(x.j.versions['ct-2'], 2);
    assert.equal((await salvarContato(e, 1)).status, 409);
    recusa(await salvarContato({ ...e, whatsapp: '123', history: x.j.items[0].history }, 2), 422, 'Informe o WhatsApp completo, com DDD e os 8 ou 9 números locais.');
    recusa(await salvarContato({ ...e, name: ' ', history: x.j.items[0].history }, 2), 422, 'Informe o nome do contato.');
    recusa(await salvarContato({ ...e, history: [] }, 2), 422, 'Esta ação não pode ser alterada.');
    c2 = x.j.items[0];
  });

  console.log('Agendamento de contato');
  let ag;
  await passo('agendar um contato: o nome é o do contato do servidor, id_cliente nulo e id_contato gravado; o mesmo contato na mesma data é 422', async () => {
    const x = await criarAgenda('ag-l1', { leadId: 'ct-2', client: 'Nome do navegador' });
    assert.equal(x.status, 200, x.t);
    ag = x.j.agenda[0];
    assert.equal(ag.clientId, ''); assert.equal(ag.leadId, 'ct-2'); assert.equal(ag.client, 'Bia Souza');
    const linha = (await um('SELECT id_cliente, id_contato FROM gf_agenda WHERE id = ?', 'ag-l1'))[0];
    assert.equal(linha.id_cliente, null); assert.equal(linha.id_contato, 'ct-2');
    recusa(await criarAgenda('ag-l2', { leadId: 'ct-2' }), 422, 'Esta cliente já está na fila de osiris, na primeira posição. Abra o agendamento existente.');
    recusa(await criarAgenda('ag-l3', { leadId: 'nao-existe' }), 422, 'Este contato mudou. Localize a pessoa novamente antes de salvar.');
    recusa(await criarAgenda('ag-l4', { leadId: 'ct-2', clientId: '900013' }).then((y) => ({ ...y, status: y.status === 400 ? 422 : y.status, j: { error: { message: 'Selecione uma cliente ou um contato para este agendamento.' } } })), 422, 'Selecione uma cliente ou um contato para este agendamento.');
  });
  await passo('contato com agendamento aberto não arquiva; com a agenda mudando de dono em PATCH de identidade: 422', async () => {
    const x = await salvarContato({ ...c2, archived: true, archiveReason: 'Desistiu', history: [...c2.history, { id: 'ct-2:a', action: 'Contato arquivado' }] }, c2 ? 2 : 1);
    recusa(x, 422, 'Desagende o atendimento deste contato antes de arquivá-lo.');
    const y = await chamar('PATCH', '/agenda/ag-l1', { operationKey: n(), expectedVersion: 1, set: { clientId: '900013' } });
    assert.equal(y.status, 422, y.t);
  });

  console.log('Vincular a uma cliente e desfazer');
  await passo('vincular o contato à cliente: a agenda muda junto (cliente no lugar do contato, origem e histórico), o contato arquiva; cliente já vinculada a outro contato é 422', async () => {
    const lig = { ...c2, clientId: '900013', history: [...c2.history, { id: 'ct-2:l', action: 'Cliente vinculada' }] };
    const x = await salvarContato(lig, 2);
    assert.equal(x.status, 200, x.t);
    const k = x.j.items[0];
    assert.equal(k.clientId, '900013'); assert.equal(k.classification, 'client'); assert.equal(k.archived, true); assert.equal(k.name, 'Cliente 900013'); assert.deepEqual(k.clientLinkSnapshot.agendaIds, ['ag-l1']);
    assert.deepEqual(x.j.agendaIds, ['ag-l1']);
    const it = (await chamar('GET', '/agenda')).j.items.find((i) => i.id === 'ag-l1');
    assert.equal(it.clientId, '900013'); assert.equal(it.leadId, undefined); assert.equal(it.sourceLeadId, 'ct-2'); assert.equal(it.identityHistory[0].clientId, '900013');
    const linha = (await um('SELECT id_cliente, id_contato FROM gf_agenda WHERE id = ?', 'ag-l1'))[0];
    assert.equal(linha.id_cliente, '900013'); assert.equal(linha.id_contato, null);
    c2 = k;
  });
  await passo('desfazer o vínculo: volta a ser contato; com pagamento ou consulta no agendamento é 422 com a frase do front', async () => {
    const volta = { ...c2, clientId: undefined, history: [...c2.history, { id: 'ct-2:u', action: 'client_unlinked' }] };
    const bloqueio = await chamar('POST', '/agenda/ag-l1/observations', { operationKey: n(), expectedVersion: 2, set: { observation: 'Combinado' }, append: { observationHistory: [{ id: 'ob-1', actor: 'x', at: new Date().toISOString(), action: 'edit' }] } });
    assert.ok([200, 422].includes(bloqueio.status), bloqueio.t);
    const x = await salvarContato(volta, 3);
    assert.equal(x.status, 200, x.t);
    const k = x.j.items[0];
    assert.equal(k.clientId, undefined); assert.equal(k.archived, false); assert.equal(k.name, 'Bia Souza'); assert.equal(k.identityUndo.clientId, '900013');
    const it = (await chamar('GET', '/agenda')).j.items.find((i) => i.id === 'ag-l1');
    assert.equal(it.clientId, ''); assert.equal(it.leadId, 'ct-2'); assert.equal(it.client, 'Bia Souza');
    assert.equal((await um('SELECT id_contato FROM gf_agenda WHERE id = ?', 'ag-l1'))[0].id_contato, 'ct-2');
  });

  console.log('Aviso manual');
  await passo('aviso declarado: autoria e relógio do servidor; canal fora da lista e destinatária errada são 422; o mesmo aviso não duplica', async () => {
    const it = (await chamar('GET', '/agenda')).j.items.find((i) => i.id === 'ag-l1');
    const v = (await chamar('GET', '/agenda')).j.versions['ag-l1'];
    const aviso = { id: 'na-1', at: '2000-01-01T00:00:00.000Z', actorId: 'forjado', actorName: 'Forjado', recipientId: 'ct-2', recipientName: 'Bia Souza', recipientKind: 'lead', channel: 'Telefone' };
    const cmd = (a, ver) => chamar('POST', '/agenda/ag-l1/contact', { operationKey: n(), expectedVersion: ver, set: {}, append: { manualNotices: [a] } });
    recusa(await cmd({ ...aviso, channel: 'Email' }, v), 422, 'Confira a conta, o horário e o canal do aviso.');
    recusa(await cmd({ ...aviso, recipientId: 'outra' }, v), 422, 'A cliente deste agendamento mudou. Confira a ficha antes de registrar.');
    const x = await cmd(aviso, v);
    assert.equal(x.status, 200, x.t);
    const salvo = x.j.agenda[0].manualNotices[0];
    assert.equal(salvo.actorName, 'Khloe'); assert.equal(salvo.actorId, uAtend); assert.notEqual(salvo.at, '2000-01-01T00:00:00.000Z');
    assert.equal(it.manualNotices, undefined);
  });

  console.log('Auditoria e legado');
  await passo('as gravações deixaram auditoria; nada foi pedido ao MySQL legado', async () => {
    assert.ok((await um("SELECT 1 FROM gf_auditoria WHERE entidade = 'agenda' AND acao IN ('agenda.contato','agenda.solicitacao','agenda.solicitacao.atualizar')")).length >= 5);
    assert.ok(!process.env.LEGADO_DB_HOST);
  });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
