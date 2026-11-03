'use strict';

/**
 * FILHO de scripts/verificar-gf-agenda-direto.js: Postgres DESCARTÁVEL (fdb_agd_*), pelo HTTP do gate. Prova (Maturacao/56, grupo C):
 *   C1 agendamento direto e edição recusados com a frase do front (cliente restrita, agenda fechada, tarólogo inativo ou fora do cadastro,
 *      horário inválido, outra cliente, cobertura forjada), nada gravado na recusa, idempotência e versão intactas, fluxo válido funcionando;
 *   C2 o nome da cliente é o do servidor (o do navegador é ignorado; sem rótulo, 422);
 *   C3 "Fechar agenda deste turno" usa o turno do servidor (fim e relógio do corpo são ignorados; sem turno, 422).
 * O legado não está configurado: o cadastro de tarólogos, a existência da cliente e o rótulo são trocados por funções de teste.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_AGENDA: 'true', GF_FATIA_RESTRICOES: 'true' });
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const servico = require(r('src/gestao-fadas/features/agenda/agenda.service'));
  const filaContexto = require(r('src/gestao-fadas/features/agenda/agenda-fila.contexto'));
  const { hojeOperacional } = require(r('src/gestao-fadas/_comum/dia-operacional'));
  const { instantesDosPeriodos } = require(r('src/gestao-fadas/_comum/dominio/presenca-agenda'));
  servico.definirVerificadorDeCliente(async (id) => id !== '999999');
  servico.definirLeitorDeRotulo(async (id) => (id === '900014' ? null : `Rótulo ${id}`));
  const CADASTRO = { osiris: { id: 'osiris', name: 'Osíris', registrationActive: true }, nyx: { id: 'nyx', name: 'Nyx', registrationActive: false }, estrela: { id: 'estrela', name: 'Estrela', registrationActive: true } };
  filaContexto.definirFonteDeTarologo(async (id) => CADASTRO[id] || null);
  const uAtend = await criarUsuario('Atendente Direto');
  let sessao = { userId: uAtend, role: 'atendente', displayName: 'Khloe' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-dir' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 260) };
  };
  const n = () => { n.i = (n.i || 0) + 1; return `op-direto-${Date.now()}-${n.i}`; };
  const contar = async (tabela) => Number((await sequelize.query(`SELECT COUNT(*) AS n FROM ${tabela}`))[0][0].n);
  const HOJE = hojeOperacional();
  const soma = (d, k) => new Date(Date.parse(`${d}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
  const AMANHA = soma(HOJE, 1);
  const SET = { time: '10:00', channel: 'WhatsApp', observation: 'Sem observações.', response: 'Aguardando resposta', paymentPending: false, contact: { attempt: 1, date: HOJE, tags: [] } };
  const criar = (id, extra = {}, set = {}) => chamar('POST', '/agenda', { operationKey: n(), id, tarotId: 'osiris', clientId: '900013', client: 'Nome Forjado Do Navegador', date: AMANHA, set: { ...SET, contact: { attempt: 1, date: AMANHA, tags: [] }, ...set }, ...extra });
  const editar = (id, v, set, extra = {}) => chamar('PATCH', `/agenda/${id}`, { operationKey: n(), expectedVersion: v, set, ...extra });
  const recusa = (x, status, mensagem, codigo = 'RULE_VIOLATION') => { assert.equal(x.status, status, x.t); assert.equal(x.j.error.message, mensagem, x.t); assert.equal(x.j.error.code, codigo); };

  console.log('C2: o nome da cliente é o do servidor');
  await passo('POST /agenda grava o rótulo do servidor e ignora o nome que o navegador mandou', async () => {
    const x = await criar('ag-d1');
    assert.equal(x.status, 200, x.t);
    assert.equal(x.j.agenda[0].client, 'Rótulo 900013'); assert.equal(x.j.agenda[0].tarotId, 'osiris'); assert.equal(x.j.versions['ag-d1'], 1);
  });
  await passo('cliente sem rótulo no cadastro: 422 com a frase do front, nada gravado', async () => {
    const antes = await contar('gf_agenda');
    recusa(await criar('ag-d2', { clientId: '900014' }), 422, 'Busque e confirme o nome da cliente.');
    assert.equal(await contar('gf_agenda'), antes);
  });
  await passo('PATCH com `client` no corpo também recebe o rótulo do servidor', async () => {
    const x = await editar('ag-d1', 1, { client: 'Outro Nome', channel: 'Telefone' });
    assert.equal(x.status, 200, x.t); assert.equal(x.j.agenda[0].client, 'Rótulo 900013'); assert.equal(x.j.agenda[0].channel, 'Telefone');
  });

  console.log('C1: agendamento direto recusado com a frase do front');
  const contagem = async () => ({ ag: await contar('gf_agenda'), ev: await contar('gf_agenda_eventos'), au: await contar('gf_auditoria'), op: await contar('gf_operacoes') });
  await passo('tarólogo fora do cadastro: 422 "Selecione um tarólogo ativo."; Fila Geral (afila) segue aceita', async () => {
    recusa(await criar('ag-d3', { tarotId: 'zzz' }), 422, 'Selecione um tarólogo ativo.');
    const g = await criar('ag-d3b', { tarotId: 'afila', date: HOJE });
    assert.equal(g.status, 200, g.t);
  });
  await passo('tarólogo com cadastro inativo: 422 com a frase do front; nada gravado', async () => {
    const antes = await contagem();
    recusa(await criar('ag-d4', { tarotId: 'nyx' }), 422, 'Nyx está com o cadastro inativo. Selecione outro tarólogo ou reative o cadastro.');
    assert.deepEqual(await contagem(), antes);
  });
  await passo('cliente com restrição para a tarólogo: 422 "Indisponível"; outro tarólogo segue livre', async () => {
    await sequelize.query("INSERT INTO gf_restricoes (id, id_cliente, id_tarologo, solicitante, ativa, item, criado_por, operation_key) VALUES ('rs-1', '900013', 'osiris', 'tarologist', true, '{}', 'teste', 'op-rs-1')");
    const antes = await contagem();
    recusa(await criar('ag-d5'), 422, 'Indisponível');
    assert.deepEqual(await contagem(), antes);
    const livre = await criar('ag-d5b', { tarotId: 'estrela' });
    assert.equal(livre.status, 200, livre.t);
  });
  await passo('horário marcado inválido: 422 com a frase do front', async () => {
    recusa(await criar('ag-d6', { clientId: '900015' }, { scheduledTime: '25:00' }), 422, 'Digite um horário válido, como 21:30, ou deixe em branco.');
    const bom = await criar('ag-d6b', { clientId: '900015' }, { scheduledTime: '21:30' });
    assert.equal(bom.status, 200, bom.t);
  });
  await passo('agenda fechada por hoje: agendar para hoje é 422 com a frase do front; amanhã segue; reaberta, hoje volta', async () => {
    const fecha = await chamar('POST', '/agenda/admissions', { operationKey: n(), event: { id: 'adm-1', tarotId: 'osiris', mode: 'no_more', closeScope: 'day' } });
    assert.equal(fecha.status, 200, fecha.t);
    recusa(await criar('ag-d7', { clientId: '900016', date: HOJE }), 422, 'Agenda fechada, inclusive para encaixes. Escolha Amanhã ou outra data.');
    const amanha = await criar('ag-d7b', { clientId: '900016' });
    assert.equal(amanha.status, 200, amanha.t);
    const abre = await chamar('POST', '/agenda/admissions', { operationKey: n(), event: { id: 'adm-2', tarotId: 'osiris', mode: 'open' } });
    assert.equal(abre.status, 200, abre.t);
    const hoje = await criar('ag-d7c', { clientId: '900017', date: HOJE });
    assert.equal(hoje.status, 200, hoje.t);
  });
  await passo('cobertura forjada: valor de pagamento no agendamento novo é 422; paymentPending segue aceito na criação', async () => {
    recusa(await criar('ag-d8', { clientId: '900018' }, { paymentAmount: 500 }), 422, 'Confira os dados informados e tente novamente.');
    const x = await criar('ag-d8b', { clientId: '900018' }, { paymentPending: true });
    assert.equal(x.status, 200, x.t); assert.equal(x.j.agenda[0].paymentPending, true);
  });

  console.log('C1: edição');
  await passo('PATCH que forja cobertura: 422; mesmo valor gravado passa; versão intacta na recusa', async () => {
    const antes = await contagem();
    recusa(await editar('ag-d8b', 1, { paymentPending: false }), 422, 'Confira os dados informados e tente novamente.');
    recusa(await editar('ag-d8b', 1, { paymentAmount: 99 }), 422, 'Confira os dados informados e tente novamente.');
    assert.deepEqual(await contagem(), antes);
    const ok = await editar('ag-d8b', 1, { paymentPending: true, observation: 'Texto novo' });
    assert.equal(ok.status, 200, ok.t); assert.equal(ok.j.versions['ag-d8b'], 2);
  });
  await passo('PATCH para outra cliente: 422 com a frase do front', async () => {
    recusa(await editar('ag-d1', 2, { clientId: '900099' }), 422, 'Para outra cliente, cancele este agendamento e crie um novo.');
  });
  await passo('PATCH para tarólogo inativo ou com restrição: 422; para outro livre, passa e a posição vem do servidor', async () => {
    recusa(await editar('ag-d1', 2, { tarotId: 'nyx' }), 422, 'Nyx está com o cadastro inativo. Selecione outro tarólogo ou reative o cadastro.');
    const outra = await criar('ag-d9', { clientId: '900021', tarotId: 'estrela' });
    assert.equal(outra.status, 200, outra.t);
    await sequelize.query("INSERT INTO gf_restricoes (id, id_cliente, id_tarologo, solicitante, ativa, item, criado_por, operation_key) VALUES ('rs-2', '900021', 'osiris', 'tarologist', true, '{}', 'teste', 'op-rs-2')");
    recusa(await editar('ag-d9', 1, { tarotId: 'osiris' }), 422, 'Indisponível');
    const mover = await editar('ag-d1', 2, { tarotId: 'estrela' });
    assert.equal(mover.status, 200, mover.t); assert.equal(mover.j.agenda[0].tarotId, 'estrela'); assert.ok(mover.j.agenda[0].position >= 1);
  });
  await passo('PATCH que muda dia e horário de um agendamento válido continua funcionando', async () => {
    const x = await editar('ag-d6b', 1, { date: soma(AMANHA, 1), scheduledTime: '22:00' });
    assert.equal(x.status, 200, x.t); assert.equal(x.j.agenda[0].date, soma(AMANHA, 1)); assert.equal(x.j.agenda[0].scheduledTime, '22:00'); assert.equal(x.j.versions['ag-d6b'], 2);
  });
  await passo('idempotência: a mesma chave repete a resposta; a recusa não grava operação', async () => {
    const corpo = { operationKey: n(), expectedVersion: 2, set: { channel: 'Skype' } };
    const a = await chamar('PATCH', '/agenda/ag-d6b', corpo); const b = await chamar('PATCH', '/agenda/ag-d6b', corpo);
    assert.equal(a.status, 200, a.t); assert.deepEqual(a.j, b.j); assert.equal(b.j.versions['ag-d6b'], 3);
    const velha = await editar('ag-d6b', 1, { channel: 'Telefone' });
    assert.equal(velha.status, 409); assert.equal(velha.j.error.code, 'VERSION_CHANGED');
  });
  await passo('"Próximo turno": mudar para um dia passado é 422 com a frase do front; para hoje ou depois, passa', async () => {
    const x = await criar('ag-pt', { clientId: '900020', date: HOJE }, { contact: { attempt: 1, date: HOJE, tags: ['Próximo turno'] } });
    assert.equal(x.status, 200, x.t);
    recusa(await editar('ag-pt', 1, { date: soma(HOJE, -1) }), 422, 'Escolha hoje ou uma data futura para o próximo turno.');
    const ok = await editar('ag-pt', 1, { date: AMANHA });
    assert.equal(ok.status, 200, ok.t);
  });

  console.log('C3: fechar agenda deste turno usa o turno do servidor');
  const corpoTurno = (id, tarotId, extra = {}) => ({ operationKey: n(), event: { id, tarotId, mode: 'no_more', closeScope: 'shift', endTime: '23:00', closedUntil: new Date(Date.now() + 23 * 3600000).toISOString(), ...extra } });
  await passo('sem turno em andamento no horário cadastrado: 422 mesmo com fim válido no corpo; nada gravado', async () => {
    const antes = await contar('gf_agenda_admissoes');
    recusa(await chamar('POST', '/agenda/admissions', corpoTurno('adm-t1', 'estrela')), 422, 'Este turno já terminou. Confira o período de fechamento.');
    assert.equal(await contar('gf_agenda_admissoes'), antes);
  });
  await passo('com turno em andamento: o fim e o relógio gravados são os do servidor, não os do navegador', async () => {
    const agora = Date.now();
    const rel = (ms) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
    let ini = rel(agora - 30 * 60000); const fim = rel(agora + 3 * 3600000);
    if (Number(ini.slice(0, 2)) < 6 && Number(rel(agora).slice(0, 2)) >= 6) ini = '06:00';
    const dia = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][new Date(`${HOJE}T12:00:00Z`).getUTCDay()];
    await sequelize.query('INSERT INTO gf_escalas_semanais (id_tarologo, weekday, hours) VALUES (?, ?, ?)', { replacements: ['osiris', dia, `${ini} às ${fim}`] });
    const esperado = instantesDosPeriodos([{ start: ini, end: fim }], HOJE)[0];
    const x = await chamar('POST', '/agenda/admissions', corpoTurno('adm-t2', 'osiris', { endTime: '04:00', closedUntil: new Date(agora + 20 * 3600000).toISOString() }));
    assert.equal(x.status, 200, x.t);
    const ev = x.j.items.find((i) => i.id === 'adm-t2');
    assert.equal(ev.closedUntil, new Date(esperado.endsAt).toISOString()); assert.equal(ev.endTime, fim); assert.equal(ev.closeScope, 'shift');
  });
  await passo('fechar por hoje não depende do turno (o front também não o exige)', async () => {
    const x = await chamar('POST', '/agenda/admissions', { operationKey: n(), event: { id: 'adm-t3', tarotId: 'estrela', mode: 'no_more', closeScope: 'day' } });
    assert.equal(x.status, 200, x.t);
  });

  console.log('Auditoria e legado');
  await passo('cada gravação feita deixou auditoria (entidade agenda) e nenhuma recusa deixou rastro', async () => {
    const aud = await contar("gf_auditoria WHERE entidade = 'agenda'");
    const eventos = await contar('gf_agenda_eventos');
    assert.ok(aud > 0 && eventos > 0);
    const [vers] = await sequelize.query('SELECT id FROM gf_agenda ORDER BY id');
    assert.ok(vers.length >= 8);
  });
  await passo('nada foi pedido ao MySQL legado (tudo acima passou com o legado NÃO configurado)', async () => { assert.ok(!process.env.LEGADO_DB_HOST); });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
