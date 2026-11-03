'use strict';

/**
 * FILHO de scripts/verificar-gf-painel.js: roda contra o Postgres DESCARTÁVEL (fdb_pnl_*) já migrado, com DB_* só no ambiente deste
 * processo. Prova pelo HTTP do gate (sessão de mentira, usuários reais da A no banco): admissão do turno (o servidor recalcula), solicitações
 * (só a própria taróloga pede, a equipe resolve), encaminhar/reservar e liberar a fila geral com as validações do front, relógio do servidor
 * nos eventos da Agenda, regras de início (continuação reservada, reserva da fila geral, turno confirmado) e as fontes completas do Painel.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true',
  GF_FATIA_AGENDA: 'true', GF_FATIA_CONSULTA: 'true', GF_FATIA_PRESENCA: 'true', GF_FATIA_HORARIOS: 'true', GF_FATIA_PRECOS: 'true', GF_FATIA_PAGAMENTOS: 'true', GF_FATIA_RESTRICOES: 'true', GF_FATIA_PAINEL: 'true' });
const r = (p) => path.join(raiz, p);
const HOJE = () => require(r('src/gestao-fadas/_comum/dia-operacional')).hojeOperacional();

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const agendaServico = require(r('src/gestao-fadas/features/agenda/agenda.service'));
  const admissao = require(r('src/gestao-fadas/features/agenda/agenda-admissao.service'));
  require(r('src/gestao-fadas/features/financeiro-cliente/restricoes.service')).definirVerificadorDeCliente(async (id) => id !== '999999');
  const contexto = require(r('src/gestao-fadas/features/agenda/agenda-fila.contexto'));
  const consulta = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.service'));
  const clientesOk = async (id) => id !== '999999';
  agendaServico.definirVerificadorDeCliente(clientesOk); admissao.definirVerificadorDeCliente(clientesOk); consulta.definirVerificadorDeCliente(clientesOk);
  const CADASTRO = { osiris: { id: 'osiris', name: 'Osíris', registrationActive: true }, nyx: { id: 'nyx', name: 'Nyx', registrationActive: true }, inativa: { id: 'inativa', name: 'Inativa', registrationActive: false }, sem: { id: 'sem', name: 'Sem Presença', registrationActive: true }, livre: { id: 'livre', name: 'Livre', registrationActive: true } };
  contexto.definirFonteDeTarologo(async (id) => CADASTRO[id] || null);
  const uAtend = await criarUsuario('Atendente Painel');
  const uAdm = await criarUsuario('Administradora Painel');
  const uOsiris = await criarUsuario('Osíris Painel');
  const uNyx = await criarUsuario('Nyx Painel');
  const uLivre = await criarUsuario('Livre Painel');
  const NOMES = { atendente: ['Khloe', uAtend], administradora: ['Laya', uAdm] };
  let sessao = { userId: uAtend, role: 'atendente', displayName: 'Khloe' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-pnl' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined || metodo === 'GET' ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 300), h: resp.headers };
  };
  const como = (perfil, extra = {}) => {
    sessao = perfil === 'osiris' ? { userId: uOsiris, role: 'tarologa', displayName: 'Osíris', tarotId: 'osiris' } : perfil === 'nyx' ? { userId: uNyx, role: 'tarologa', displayName: 'Nyx', tarotId: 'nyx' } : perfil === 'livre' ? { userId: uLivre, role: 'tarologa', displayName: 'Livre', tarotId: 'livre' }
      : { userId: NOMES[perfil][1], role: perfil, displayName: NOMES[perfil][0], ...extra };
  };
  const n = () => { n.i = (n.i || 0) + 1; return `op-${Date.now()}-${n.i}`; };
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);
  const AGORA = () => new Date().toISOString();
  const hoje = HOJE();
  const evContato = (id, tag, extra = {}) => ({ id, actor: 'x', at: '2000-01-01T00:00:00.000Z', date: hoje, attempt: 1, tag, active: true, before: [], after: [tag], ...extra });
  // Cliente na fila geral, já avisada e disponível ("Pode agora"), como a tela a mostra.
  const criarNaFila = (id, clientId, extra = {}) => chamar('POST', '/agenda', { operationKey: n(), id, tarotId: 'afila', clientId, client: `Cliente ${clientId}`, date: hoje,
    set: { channel: 'WhatsApp', observation: 'Sem observações.', response: 'Aguardando resposta', contact: { attempt: 1, date: hoje, tags: ['Avisada'] }, workflowStatus: 'Avisada' }, append: { contactHistory: [evContato(`${id}-av`, 'Avisada')] }, ...extra });
  const encaminhar = (id, v, tarotId, extra = {}) => chamar('POST', `/agenda/${id}/route-general`, { operationKey: n(), expectedVersion: v, tarotId, ...extra });
  const liberar = (id, v, extra = {}) => chamar('POST', `/agenda/${id}/reservation/release`, { operationKey: n(), expectedVersion: v, ...extra });
  const presenca = async (tarot, perfil) => { como(perfil); const c = await chamar('POST', `/presence/${tarot}/confirm`, { operationKey: n(), expectedRevision: '0' }); assert.equal(c.status, 200, c.t); como('atendente'); };

  console.log('Esquema');
  await passo('2 tabelas da fatia existem e a migração roda de novo sem erro', async () => {
    const [t] = await sequelize.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('gf_agenda_admissoes','gf_agenda_solicitacoes')");
    assert.equal(t.length, 2);
    await require(r('migrations/20261114000000-gestao-fadas-painel')).up({ sequelize });
  });

  console.log('Fontes do Painel (vazias)');
  como('atendente');
  await passo('GET /agenda e GET /panel/sources: intakeEvents e requests vazios, nada em "missing"', async () => {
    const a = await chamar('GET', '/agenda'); assert.equal(a.status, 200, a.t); assert.deepEqual(a.j.intakeEvents, []); assert.deepEqual(a.j.requests, []);
    const p = await chamar('GET', '/panel/sources'); assert.equal(p.status, 200, p.t); assert.deepEqual(p.j.missing, []); assert.deepEqual(p.j.intakeEvents, []);
  });

  console.log('Admissão do turno');
  const ad = (id, mode, extra = {}) => chamar('POST', '/agenda/admissions', { operationKey: n(), event: { id, tarotId: 'osiris', mode, ...extra } });
  const f1 = (await criarNaFila('ag-f1', '900013')); // só para ter um agendamento aberto do tarólogo? (ela está na fila geral): o de Osíris vem abaixo
  await passo('cliente na fila geral criada (versão 1)', () => assert.equal(f1.status, 200, f1.t));
  const o1 = await chamar('POST', '/agenda', { operationKey: n(), id: 'ag-o1', tarotId: 'osiris', clientId: '900014', client: 'Cliente 900014', date: hoje, set: { channel: 'WhatsApp', observation: '.', response: 'Aguardando resposta' } });
  await passo('fechar por hoje: o servidor põe dia, instante, fim do dia e os agendamentos que já estavam na fila; reabrir volta a aberta', async () => {
    const x = await ad('adm-1', 'no_more', { closeScope: 'day', at: '2000-01-01T00:00:00.000Z', date: '2000-01-01', agendaIds: ['inventado'], consultationIds: ['x'], closedUntil: '2000-01-02T00:00:00.000Z' });
    assert.equal(x.status, 200, x.t);
    const e = x.j.items[0];
    assert.equal(e.date, hoje); assert.notEqual(e.at, '2000-01-01T00:00:00.000Z'); assert.equal(e.by, 'Khloe'); assert.deepEqual(e.agendaIds, ['ag-o1']); assert.deepEqual(e.consultationIds, []);
    assert.match(e.closedUntil, /T09:00:00\.000Z$/); assert.ok(Date.parse(e.closedUntil) > Date.now()); assert.equal(e.closeScope, 'day');
    const lido = await chamar('GET', '/agenda/admissions'); assert.equal(lido.j.items.length, 1);
    const y = await ad('adm-2', 'open'); assert.equal(y.status, 200, y.t); assert.equal(y.j.items[0].mode, 'open');
    const todos = (await chamar('GET', '/agenda')).j.intakeEvents; assert.deepEqual(todos.map((v) => v.id), ['adm-1', 'adm-2']);
  });
  await passo('fechar por turno: o fim e o relógio são os do turno do servidor (Maturacao/56, C3); sem turno é 422; id repetido com outra chave é 409; mesma chave repete a resposta; forma inválida é 400', async () => {
    // Osíris tem escala cobrindo o agora; o fim e o relógio do corpo (que o navegador mandava) são ignorados.
    const rel = (ms) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
    const agora = Date.now(); let ini = rel(agora - 30 * 60000); const fimRel = rel(agora + 3 * 3600000);
    if (Number(ini.slice(0, 2)) < 6 && Number(rel(agora).slice(0, 2)) >= 6) ini = '06:00';
    const dia = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][new Date(`${hoje}T12:00:00Z`).getUTCDay()];
    await sequelize.query('INSERT INTO gf_escalas_semanais (id_tarologo, weekday, hours) VALUES (?, ?, ?)', { replacements: ['osiris', dia, `${ini} às ${fimRel}`] });
    const esperado = require(r('src/gestao-fadas/_comum/dominio/presenca-agenda')).instantesDosPeriodos([{ start: ini, end: fimRel }], hoje)[0];
    const fim = new Date(Date.now() + 3600000).toISOString();
    const chave = n();
    const corpo = { operationKey: chave, event: { id: 'adm-3', tarotId: 'osiris', mode: 'no_more', closeScope: 'shift', endTime: '23:00', closedUntil: fim } };
    const a = await chamar('POST', '/agenda/admissions', corpo); assert.equal(a.status, 200, a.t); assert.equal(a.j.items[0].endTime, fimRel); assert.equal(a.j.items[0].closedUntil, new Date(esperado.endsAt).toISOString());
    const b = await chamar('POST', '/agenda/admissions', corpo); assert.deepEqual(b.j, a.j);
    assert.equal((await ad('adm-3', 'open')).status, 409);
    const velho = await ad('adm-4', 'no_more', { tarotId: 'nyx', closeScope: 'shift', endTime: '23:00', closedUntil: new Date(Date.now() - 60000).toISOString() }); assert.equal(velho.status, 422); assert.equal(velho.j.error.message, 'Este turno já terminou. Confira o período de fechamento.')
    assert.equal((await ad('adm-5', 'count')).status, 400); assert.equal((await ad('adm-5', 'no_more', { closeScope: 'tudo' })).status, 400);
    await ad('adm-6', 'open');
  });

  console.log('Solicitações de consulta');
  await passo('a taróloga pede (tarotId, dia e instante do servidor); pedido repetido da mesma cliente é o mesmo; a equipe NÃO pede', async () => {
    como('osiris');
    const pedido = (id) => chamar('POST', '/agenda/requests', { operationKey: n(), request: { id, tarotId: 'nyx', clientId: '900015', client: 'Cliente 900015', date: '2000-01-01', at: '2000-01-01T00:00:00.000Z', note: ' quer hoje ' } });
    const a = await pedido('sol-1'); assert.equal(a.status, 200, a.t);
    const s = a.j.items[0]; assert.equal(s.tarotId, 'osiris'); assert.equal(s.date, hoje); assert.notEqual(s.at, '2000-01-01T00:00:00.000Z'); assert.equal(s.note, 'quer hoje');
    const b = await pedido('sol-2'); assert.equal(b.status, 200); assert.equal(b.j.items[0].id, 'sol-1');
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_agenda_solicitacoes'), 1);
    const sem = await chamar('POST', '/agenda/requests', { operationKey: n(), request: { id: 'sol-3', clientId: '999999', client: 'x' } }); assert.equal(sem.status, 404);
    como('atendente'); assert.equal((await pedido('sol-4')).status, 403);
  });
  await passo('a equipe lê em GET /agenda e no Painel e resolve (resolvedAt e resolvedBy do servidor); versão velha é 409; agendamento inexistente é 422', async () => {
    como('atendente');
    assert.equal((await chamar('GET', '/agenda')).j.requests.length, 1);
    const p = await chamar('GET', '/panel/sources'); assert.equal(p.j.requests[0].id, 'sol-1'); assert.equal(p.j.intakeEvents.length, 4);
    const res = (v, agendaId) => chamar('POST', '/agenda/requests/sol-1/resolve', { operationKey: n(), expectedVersion: v, agendaId });
    assert.equal((await res(1, 'nao-existe')).status, 422);
    const x = await res(1, 'ag-o1'); assert.equal(x.status, 200, x.t);
    assert.equal(x.j.items[0].agendaId, 'ag-o1'); assert.equal(x.j.items[0].resolvedBy, 'Khloe'); assert.ok(Date.parse(x.j.items[0].resolvedAt)); assert.equal(x.j.versions['sol-1'], 2);
    assert.equal((await res(1, 'ag-o1')).status, 409);
    como('osiris'); assert.equal((await chamar('GET', '/agenda/requests')).status, 403);
  });

  console.log('Fila geral: encaminhar (reservar) e liberar');
  como('atendente');
  await presenca('osiris', 'osiris'); await presenca('nyx', 'nyx'); await presenca('livre', 'livre');
  // Osíris tem o agendamento próprio `ag-o1` na fila de hoje: pela regra do front (`hasBooking`) ela NÃO está livre; 'livre' não tem fila própria.
  const f2 = await criarNaFila('ag-f2', '900016'); const f3 = await criarNaFila('ag-f3', '900017');
  await passo('reservar: o servidor refaz a mudança com o relógio e o nome dele (queueReservation e histórico); a cliente continua na fila geral', async () => {
    const fx = await chamar('GET', '/agenda'); const v = (id) => fx.j.versions[id];
    const x = await encaminhar('ag-f1', v('ag-f1'), 'livre'); assert.equal(x.status, 200, x.t);
    const it = x.j.agenda[0];
    assert.equal(it.tarotId, 'afila'); assert.equal(it.queueReservation.tarotId, 'livre'); assert.equal(it.queueReservation.by, 'Khloe'); assert.ok(Math.abs(Date.parse(it.queueReservation.at) - Date.now()) < 5000);
    assert.equal(it.queueReservationHistory.length, 1); assert.equal(x.j.versions['ag-f1'], 2);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_agenda_eventos WHERE id_agenda = 'ag-f1' AND evento_ref LIKE 'fila:%'"), 1);
  });
  await passo('a mesma taróloga já reservada para outra cliente: 422 com a frase do front', async () => {
    const v = (await chamar('GET', '/agenda')).j.versions['ag-f2'];
    const x = await encaminhar('ag-f2', v, 'livre'); assert.equal(x.status, 422, x.t); assert.match(x.j.error.message, /^Livre já está reservada para 900013 · Cliente 900013\. Escolha outra taróloga\.$/);
  });
  await passo('regras do destino: tarólogo inativo ou desconhecido, versão velha, restrição, agenda fechada, turno não confirmado', async () => {
    const v = (id) => chamar('GET', '/agenda').then((x) => x.j.versions[id]);
    assert.equal((await encaminhar('ag-f2', await v('ag-f2'), 'inativa')).j.error.message, 'Selecione um tarólogo ativo.');
    assert.equal((await encaminhar('ag-f2', await v('ag-f2'), 'fantasma')).j.error.message, 'Selecione um tarólogo ativo.');
    const velha = await encaminhar('ag-f2', 99, 'nyx'); assert.equal(velha.status, 409); assert.equal(velha.j.error.code, 'VERSION_CHANGED');
    // restrição cliente x taróloga bloqueia ("Indisponível")
    const rr = await chamar('PUT', '/restrictions/rest-p1', { operationKey: n(), expectedVersion: 0, record: { id: 'rest-p1', clientId: '900016', tarotId: 'nyx', requestedBy: 'client', reason: 'x', active: true, createdAt: AGORA(), createdBy: 'x', updatedAt: AGORA(), updatedBy: 'x', history: [{ action: 'created', at: AGORA(), actor: 'x', reason: 'x' }] } });
    assert.equal(rr.status, 200, rr.t);
    assert.equal((await encaminhar('ag-f2', await v('ag-f2'), 'nyx')).j.error.message, 'Indisponível');
    // agenda de Nyx fechada por hoje: bloqueia reservar
    como('atendente'); await chamar('POST', '/agenda/admissions', { operationKey: n(), event: { id: 'adm-nyx', tarotId: 'nyx', mode: 'no_more', closeScope: 'day' } });
    const f3v = await v('ag-f3');
    assert.equal((await encaminhar('ag-f3', f3v, 'nyx')).j.error.message, 'A disponibilidade mudou. Confira os tarólogos livres novamente.');
    await chamar('POST', '/agenda/admissions', { operationKey: n(), event: { id: 'adm-nyx2', tarotId: 'nyx', mode: 'open' } });
    // turno não confirmado: Offline (sem presença gravada) não recebe
    assert.equal((await encaminhar('ag-f3', f3v, 'sem')).j.error.message, 'A disponibilidade mudou. Confira os tarólogos livres novamente.');
  });
  await passo('liberar: a cliente continua em Esperando, histórico guarda quem liberou; repetir não muda nada; versão velha é 409', async () => {
    let v = (await chamar('GET', '/agenda')).j.versions['ag-f1'];
    assert.equal((await liberar('ag-f1', v - 1)).status, 409);
    const x = await liberar('ag-f1', v, { reason: 'manual' }); assert.equal(x.status, 200, x.t);
    const it = x.j.agenda[0]; assert.equal(it.tarotId, 'afila'); assert.ok(!('queueReservation' in it)); assert.equal(it.queueReservationHistory.length, 2); assert.equal(it.queueReservationHistory[1].previousTarotId, 'livre');
    v = x.j.versions['ag-f1'];
    const y = await liberar('ag-f1', v); assert.equal(y.status, 200); assert.equal(y.j.versions['ag-f1'], v, 'sem reserva ativa não grava de novo');
    assert.equal((await liberar('ag-f1', v, { reason: 'x' })).status, 400);
  });
  await passo('encaminhar de novo depois de liberar funciona; mode forward move a cliente para a fila da taróloga (posição seguinte, histórico do agendamento)', async () => {
    const v = (id) => chamar('GET', '/agenda').then((x) => x.j.versions[id]);
    assert.equal((await encaminhar('ag-f1', await v('ag-f1'), 'livre')).status, 200);
    const fw = await encaminhar('ag-f3', await v('ag-f3'), 'nyx', { mode: 'forward' }); assert.equal(fw.status, 200, fw.t);
    const it = fw.j.agenda[0]; assert.equal(it.tarotId, 'nyx'); assert.equal(it.date, hoje); assert.equal(it.position, 1); assert.equal(it.scheduleHistory.length, 1); assert.equal(it.scheduleHistory[0].actor, 'Khloe');
  });
  await passo('perfis: a taróloga leva 403; fila geral desligada em tempo de execução: 404', async () => {
    como('osiris'); assert.equal((await encaminhar('ag-f1', 1, 'osiris')).status, 403); assert.equal((await liberar('ag-f1', 1)).status, 403);
    como('atendente'); process.env.GF_FATIA_AGENDA = 'false'; try { assert.equal((await encaminhar('ag-f1', 1, 'osiris')).status, 404); } finally { process.env.GF_FATIA_AGENDA = 'true'; }
  });

  console.log('Painel: o servidor recalcula o fluxo (freeNow) e recusa como o front (Maturacao/39)');
  await passo('encaminhar para quem tem agendamento próprio acionável (Osíris, ag-o1) é 422 com a frase do front; "livre" aceita', async () => {
    const v = (await chamar('GET', '/agenda')).j.versions['ag-f2'];
    const x = await encaminhar('ag-f2', v, 'osiris'); assert.equal(x.status, 422, x.t); assert.equal(x.j.error.message, 'A disponibilidade mudou. Confira os tarólogos livres novamente.');
  });
  await passo('lançar pelo cartão da fila geral antes do horário combinado: 422 com a frase do front (nenhuma consulta nasce)', async () => {
    const futuro = new Date(Date.now() + 3 * 3600000 - 3 * 3600000).toISOString().slice(11, 16);
    const fx = await criarNaFila('ag-h1', '900030', { set: { channel: 'WhatsApp', observation: 'Sem observações.', response: 'Aguardando resposta', scheduledTime: futuro, contact: { attempt: 1, date: hoje, tags: ['Avisada'] }, workflowStatus: 'Avisada' } });
    assert.equal(fx.status, 200, fx.t);
    const antes = await contar("SELECT COUNT(*) AS n FROM gf_consultas_ext");
    const lancarQ = (id, extra) => chamar('POST', '/consultations', { operationKey: n(), record: { id, paymentProfile: 'Pós-paga', channel: 'WhatsApp', observation: 'x', expectedMinutes: 30, ...extra } });
    const x = await lancarQ('con-q1', { clientId: '900030', client: 'Cliente 900030', tarotId: 'nyx', tarot: 'Nyx', agendaItemId: 'ag-h1' }); assert.equal(x.status, 422, x.t);
    assert.match(x.j.error.message, /Aguarde o horário combinado para encaminhar\.$/); assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_consultas_ext"), antes);
  });
  await passo('agendar a cliente da fila geral: restrição é "Indisponível", taróloga inativa é recusada, cliente com outro agendamento é recusada', async () => {
    const pat = (id, v, set) => chamar('PATCH', `/agenda/${id}`, { operationKey: n(), expectedVersion: v, set });
    const v = (id) => chamar('GET', '/agenda').then((y) => y.j.versions[id]);
    const a = await pat('ag-f2', await v('ag-f2'), { tarotId: 'nyx', date: hoje }); assert.equal(a.status, 422, a.t); assert.equal(a.j.error.message, 'Indisponível');
    await criarNaFila('ag-i1', '900033');
    const b = await pat('ag-i1', await v('ag-i1'), { tarotId: 'inativa', date: hoje }); assert.equal(b.status, 422, b.t); assert.equal(b.j.error.message, 'Escolha a taróloga para o agendamento.');
    await criarNaFila('ag-d1', '900031'); await chamar('POST', '/agenda', { operationKey: n(), id: 'ag-d2', tarotId: 'osiris', clientId: '900031', client: 'Cliente 900031', date: hoje, set: { channel: 'WhatsApp', observation: '.', response: 'Aguardando resposta' } });
    const c = await pat('ag-d1', await v('ag-d1'), { tarotId: 'nyx', date: hoje }); assert.equal(c.status, 422, c.t); assert.equal(c.j.error.message, 'A cliente já tem outro agendamento. Confira sua ficha.');
  });
  await passo('agendar para uma taróloga válida passa (agendar não exige que ela esteja livre agora)', async () => {
    await criarNaFila('ag-s1', '900032');
    const v = (await chamar('GET', '/agenda')).j.versions['ag-s1'];
    const x = await chamar('PATCH', '/agenda/ag-s1', { operationKey: n(), expectedVersion: v, set: { tarotId: 'osiris', date: hoje } }); assert.equal(x.status, 200, x.t); assert.equal(x.j.agenda[0].tarotId, 'osiris');
  });

  await passo('acompanhamento de pagamento (serviceFollowUp): o navegador só acrescenta um evento; ator e instante são do servidor; história não se altera', async () => {
    require(r('src/gestao-fadas/features/financeiro-cliente/fin.contexto')).definirLeitorDePartida(async (ids) => new Map(ids.map((id) => [id, { centavos: 0, conhecido: true, nome: `Cliente ${id}` }])));
    require(r('src/gestao-fadas/features/financeiro-cliente/pagamentos.service')).definirVerificadorDeCliente(async () => true);
    const dom = (m) => require(r(`src/gestao-fadas/_comum/dominio/${m}`)); const ref = dom('pagamentos-preco').referenciaDePreco(44.4, '900040', new Date().toISOString(), dom('financeiro-base').PRECOS_PADRAO, { consultations: [], profiles: { 900040: { clientId: '900040', credit: 0, movements: [], minuteBenefits: [] } }, history: [] }, null, 'PIX');
    const rec = dom('pagamentos-lancamento').criarPagamento({ method: 'PIX', amount: '44,40', bank: 'Itaú', payerName: 'Fulana de Tal', authorization: '', note: '', ...(ref.purchase ? { purchase: ref.purchase } : { cashUnitValue: ref.cashUnitValue }) }, { clientId: '900040', client: 'Cliente 900040' }, 'Khloe', new Date().toISOString(), 'pag-s1', undefined, require(r('src/gestao-fadas/_comum/dominio/financeiro-base')).PRECOS_PADRAO); // registro igual ao que o front produz (createPaymentRecord)
    const c = await chamar('POST', '/payments', { operationKey: n(), record: rec }); assert.equal(c.status, 200, c.t);
    const v = c.j.versions['pag-s1']; const base = c.j.items[0];
    const ev = { id: 'fu-1', action: 'asked', at: '2000-01-01T00:00:00.000Z', actor: 'Invasor', reason: 'x' };
    const a = await chamar('POST', '/payments/pag-s1/revise', { operationKey: n(), expectedVersion: v, record: { ...base, serviceFollowUp: { events: [ev] } } }); assert.equal(a.status, 200, `1a revisão: ${a.t}`);
    const e1 = a.j.items[0].serviceFollowUp.events; assert.equal(e1.length, 1); assert.equal(e1[0].id, 'fu-1'); assert.equal(e1[0].actor, 'Khloe'); assert.ok(Math.abs(Date.parse(e1[0].at) - Date.now()) < 5000);
    assert.equal(e1[0].reason, 'Perguntamos se a cliente gostaria de agendar sua consulta.');
    const v2 = a.j.versions['pag-s1'];
    const alterada = await chamar('POST', '/payments/pag-s1/revise', { operationKey: n(), expectedVersion: v2, record: { ...a.j.items[0], serviceFollowUp: { events: [{ ...e1[0], actor: 'Outra' }] } } });
    assert.equal(alterada.status, 422, alterada.t); assert.match(alterada.j.error.message, /O acompanhamento do pagamento mudou/);
    const dupla = await chamar('POST', '/payments/pag-s1/revise', { operationKey: n(), expectedVersion: v2, record: { ...a.j.items[0], serviceFollowUp: { events: [e1[0], { id: 'fu-2', action: 'asked', at: AGORA(), actor: 'x', reason: 'x' }] } } });
    assert.equal(dupla.status, 200, `repetição: ${dupla.t}`); assert.equal(dupla.j.items[0].serviceFollowUp.events.length, 1, 'já perguntado: a repetição não grava');
  });

  await passo('agendar da fila geral pelo servidor (schedule-general): ele monta o agendamento (posição, cobertura, observação, plano) e recusa com a frase do front', async () => {
    await criarNaFila('ag-q1', '900050');
    const ver = () => chamar('GET', '/agenda').then((y) => y.j.versions['ag-q1']);
    const base = { operationKey: n(), tarotId: 'osiris' };
    const ruim = await chamar('POST', '/agenda/ag-q1/schedule-general', { ...base, expectedVersion: await ver(), details: { date: '2000-01-01', observation: 'x', position: 'last' } });
    assert.equal(ruim.status, 422, ruim.t); assert.equal(ruim.j.error.message, 'Escolha hoje ou uma data futura.');
    const plano = await chamar('POST', '/agenda/ag-q1/schedule-general', { operationKey: n(), tarotId: 'osiris', expectedVersion: await ver(), details: { date: hoje, observation: 'x', position: 'last', contactPlan: { who: 'staff', timing: 'exact', time: 'xx' } } });
    assert.equal(plano.status, 422, plano.t); assert.equal(plano.j.error.message, 'Informe um horário válido, como 20:00.');
    const velha = await chamar('POST', '/agenda/ag-q1/schedule-general', { operationKey: n(), tarotId: 'osiris', expectedVersion: 99, details: { date: hoje, observation: 'x', position: 'last' } });
    assert.equal(velha.status, 409, velha.t);
    const ok = await chamar('POST', '/agenda/ag-q1/schedule-general', { operationKey: n(), tarotId: 'osiris', expectedVersion: await ver(), details: { date: hoje, observation: '  Prefere à tarde  ', position: 'last', requestedTime: 'por volta das 15h' } });
    assert.equal(ok.status, 200, ok.t); const it = ok.j.agenda.find((r) => r.id === 'ag-q1');
    assert.equal(it.tarotId, 'osiris'); assert.equal(it.observation, 'Prefere à tarde'); assert.equal(it.paymentPending, true); assert.ok(it.position >= 2); assert.equal(it.scheduleHistory.length, 1); assert.equal(it.scheduleHistory[0].actor, 'Khloe'); assert.equal(it.requestedTime, 'por volta das 15h');
    const de = await chamar('POST', '/agenda/ag-q1/schedule-general', { operationKey: n(), tarotId: 'osiris', expectedVersion: ok.j.versions['ag-q1'], details: { date: hoje, observation: 'x', position: 'last' } });
    assert.equal(de.status, 422, de.t); assert.equal(de.j.error.message, 'Esta cliente não está mais disponível na Fila Geral.');
  });

  console.log('Relógio do servidor nos eventos da Agenda');
  await passo('o contato gravado leva o instante do servidor (o do navegador, de 2000, é trocado em evento e em campo do item)', async () => {
    const v = (await chamar('GET', '/agenda')).j.versions['ag-o1'];
    const x = await chamar('POST', '/agenda/ag-o1/contact', { operationKey: n(), expectedVersion: v, set: { contact: { attempt: 1, date: hoje, tags: ['Avisada'] }, workflowStatus: 'Avisada', queueDeferral: { attempt: 1, at: '2000-01-01T00:00:00.000Z', by: 'x' } }, append: { contactHistory: [evContato('ev-relogio', 'Avisada')] } });
    assert.equal(x.status, 200, x.t);
    const it = x.j.agenda[0]; assert.ok(Math.abs(Date.parse(it.contactHistory.at(-1).at) - Date.now()) < 5000); assert.equal(it.queueDeferral.at, it.contactHistory.at(-1).at);
  });
  await passo('reservar pelo caminho do delta é recusado (só o encaminhamento reserva)', async () => {
    const v = (await chamar('GET', '/agenda')).j.versions['ag-f2'];
    const x = await chamar('POST', '/agenda/ag-f2/contact', { operationKey: n(), expectedVersion: v, set: { queueReservation: { tarotId: 'osiris', at: AGORA(), by: 'x' } } });
    assert.equal(x.status, 422); assert.match(x.j.error.message, /encaminhamento da Fila Geral/);
  });

  console.log('Regras de início de consulta');
  const lancar = (id, extra = {}) => chamar('POST', '/consultations', { operationKey: n(), record: { id, clientId: '900018', client: 'Cliente 900018', tarotId: 'nyx', tarot: 'Nyx', paymentProfile: 'Pós-paga', channel: 'WhatsApp', observation: 'x', expectedMinutes: 30, ...extra } });
  await passo('lançar para a taróloga com a fila geral reservada para outra cliente: 422 com a frase do front', async () => {
    const x = await lancar('con-p1', { tarotId: 'livre', tarot: 'Livre' }); assert.equal(x.status, 422, x.t);
    assert.match(x.j.error.message, /^O tarólogo está reservado para Cliente 900013 na Fila Geral\. Desvincule a reserva antes de enviar outra consulta\.$/);
  });
  await passo('lançar para a MESMA cliente reservada é permitido (a reserva é dela)', async () => {
    const x = await lancar('con-p2', { clientId: '900013', client: 'Cliente 900013', tarotId: 'livre', tarot: 'Livre', agendaItemId: 'ag-f1' }); assert.equal(x.status, 200, x.t);
  });
  await passo('turno não confirmado: lançar para quem está Offline é 422 com a frase do front; pausa passa no início da taróloga', async () => {
    const x = await lancar('con-p3', { clientId: '900019', client: 'Cliente 900019', tarotId: 'sem', tarot: 'Sem Presença' }); assert.equal(x.status, 422, x.t);
    assert.match(x.j.error.message, /^Sem Presença precisa confirmar a disponibilidade antes de iniciar ou receber uma consulta\. O agendamento pode ser feito normalmente\.$/);
  });
  await passo('continuação reservada: lançar outra consulta para a taróloga que aguarda a continuação de uma cliente é 422; a própria continuação passa', async () => {
    // consulta de origem concluída com pedido de mais tempo (gravada direto: o fluxo de término tem a própria prova na fatia Consulta)
    const item = { clientId: '900020', client: 'Cliente 900020', tarotId: 'nyx', tarot: 'Nyx', status: 'Concluída', startedAt: new Date(Date.now() - 3600000).toISOString(), endedAt: new Date(Date.now() - 1800000).toISOString(), durationSeconds: 1200, audit: [], tarologistMoreTimeRequest: { active: true, requestedAt: AGORA(), reporterTarotId: 'nyx', reporterName: 'Nyx' }, commissionRate: 30, awaitingTarologistStart: false, updatedAt: AGORA() };
    await sequelize.query("INSERT INTO gf_consultas_ext (id, id_tarologo, id_cliente, status, comissao_percentual, aguardando_inicio, iniciada_em, encerrada_em, duracao_segundos, item, version, criado_por, operation_key) VALUES ('con-origem', 'nyx', '900020', 'Concluída', 30, false, now() - interval '1 hour', now() - interval '30 minutes', 1200, :item, 1, 'teste', 'op-origem-pnl')", { replacements: { item: JSON.stringify(item) } });
    const x = await lancar('con-p4', { clientId: '900021', client: 'Cliente 900021' }); assert.equal(x.status, 422, x.t);
    assert.match(x.j.error.message, /^O tarólogo está reservado para a continuação de Cliente 900020\. Resolva ou libere esse pedido na Agenda antes de enviar outra consulta\.$/);
    const y = await lancar('con-p5', { clientId: '900020', client: 'Cliente 900020', continuation: { sourceConsultationId: 'con-origem', kind: 'extension' } }); assert.equal(y.status, 200, y.t);
  });
  await passo('histórico já encerrado digitado pela equipe não passa por estas regras', async () => {
    const x = await lancar('con-h1', { clientId: '900022', client: 'Cliente 900022', tarotId: 'sem', tarot: 'Sem Presença', status: 'Concluída', endedAt: AGORA(), startedAt: new Date(Date.now() - 600000).toISOString(), durationSeconds: 300 });
    assert.equal(x.status, 200, x.t);
  });
  await passo('com a fatia Presença desligada o turno não é conferido (retrocompatível)', async () => {
    process.env.GF_FATIA_PRESENCA = 'false';
    try { const x = await lancar('con-p6', { clientId: '900023', client: 'Cliente 900023', tarotId: 'sem', tarot: 'Sem Presença' }); assert.equal(x.status, 200, x.t); } finally { process.env.GF_FATIA_PRESENCA = 'true'; }
  });

  console.log('Fontes completas do Painel');
  await passo('GET /panel/sources: agenda, consultas, perfis, exceções, admissão, solicitações, pagamentos, valores e restrições; nada falta; taróloga 403', async () => {
    const x = await chamar('GET', `/panel/sources?date=${hoje}`); assert.equal(x.status, 200, x.t);
    assert.deepEqual(x.j.missing, []); assert.ok(x.j.agenda.length >= 4); assert.ok(x.j.consultations.length >= 2); assert.ok(x.j.intakeEvents.length >= 6); assert.equal(x.j.requests.length, 1);
    assert.ok(x.j.restrictions.some((v) => v.id === 'rest-p1')); assert.ok(Array.isArray(x.j.payments) && 'pricing' in x.j); assert.ok(Date.parse(x.j.readAt));
    como('osiris'); assert.equal((await chamar('GET', '/panel/sources')).status, 403);
  });

  console.log('Higiene');
  await passo('auditoria e idempotência: cada gravação nova deixou linha em gf_auditoria e em gf_operacoes; nada foi pedido ao MySQL legado', async () => {
    assert.ok(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao LIKE 'agenda.admissao' OR acao LIKE 'agenda.encaminhar' OR acao LIKE 'agenda.liberar-reserva' OR acao LIKE 'agenda.solicitacao%'") >= 12);
    assert.ok(await contar("SELECT COUNT(*) AS n FROM gf_operacoes WHERE escopo LIKE 'agenda.admissao' OR escopo LIKE 'agenda.encaminhar'") >= 8);
  });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
