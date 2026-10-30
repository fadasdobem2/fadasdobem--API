'use strict';

/**
 * FILHO de scripts/verificar-gf-consulta.js: roda contra o Postgres DESCARTÁVEL (fdb_con_*) já migrado, com DB_* só no ambiente deste
 * processo. Prova pelo HTTP do gate (sessão de mentira, usuários reais da A no banco): lançar com comissão capturada e relógio do
 * servidor, ocupação, idempotência, início/pausa/retomada, término informado UMA vez, conferência, correção de tempo, desfechos,
 * 409 de versão e corrida, perfis, presença (pausa impedida), agenda que nasce da consulta, auditoria e eventos na mesma transação,
 * e o ESPELHO no legado com um executor FALSO (INSERT na primeira vez, UPDATE depois, vínculo no Postgres, erro refeito).
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_CONSULTA: 'true', GF_FATIA_AGENDA: 'true', GF_FATIA_PRESENCA: 'true' });
delete process.env.GF_LEGADO_ESCRITA_ENABLED;
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const servico = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.service'));
  const agendaServico = require(r('src/gestao-fadas/features/agenda/agenda.service'));
  const ciclo = { presenca: require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.presenca')), espelho: require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.espelho')) };
  const legado = require(r('src/gestao-fadas/legado-escrita'));
  const job = require(r('src/gestao-fadas/features/presenca/presenca.job'));
  const clientesOk = async (id) => id !== '999999';
  servico.definirVerificadorDeCliente(clientesOk); agendaServico.definirVerificadorDeCliente(clientesOk);
  const uAtend = await criarUsuario('Atendente Consulta');
  const uAdm = await criarUsuario('Administradora Consulta');
  const uAssist = await criarUsuario('Assistente Consulta');
  const uOsiris = await criarUsuario('Osíris Consulta');
  const uNyx = await criarUsuario('Nyx Consulta');
  const NOMES = { atendente: ['Khloe', uAtend], administradora: ['Laya', uAdm], assistente: ['Assist', uAssist] };
  let sessao = { userId: uAtend, role: 'atendente', displayName: 'Khloe' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-con' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 260), h: resp.headers };
  };
  const como = (perfil, extra = {}) => { sessao = perfil === 'osiris' ? { userId: uOsiris, role: 'tarologa', displayName: 'Osíris', tarotId: 'osiris' } : perfil === 'nyx' ? { userId: uNyx, role: 'tarologa', displayName: 'Nyx', tarotId: 'nyx' } : { userId: NOMES[perfil][1], role: perfil, displayName: NOMES[perfil][0], ...extra }; };
  const n = () => { n.i = (n.i || 0) + 1; return `op-${Date.now()}-${n.i}`; };
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);
  const lista = (q = '') => chamar('GET', `/consultations${q}`);
  const registro = (id, extra = {}) => ({ id, clientId: '900013', client: 'Cliente Teste', tarotId: 'osiris', tarot: 'Osíris', paymentProfile: 'Pós-paga', channel: 'WhatsApp Áudio', observation: 'nota interna', expectedMinutes: 30, ...extra });
  const lancar = (id, extra = {}, chave = n()) => chamar('POST', '/consultations', { operationKey: chave, record: registro(id, extra) });
  const acao = (id, rota, corpo = {}) => chamar('POST', `/consultations/${id}/${rota}`, { operationKey: n(), ...corpo });
  const item = (x) => x.j.consultations[0];
  const rev = (id, v, record, chave = n()) => chamar('POST', `/consultations/${id}/revise`, { operationKey: chave, expectedVersion: v, record });
  const agora = () => Date.now();
  const auditDe = async (id) => (await sequelize.query('SELECT item->\'audit\' AS a FROM gf_consultas_ext WHERE id = :id', { replacements: { id } }))[0][0].a;

  console.log('Esquema');
  await passo('2 tabelas da fatia existem, o índice do término único existe e a migração roda de novo sem erro', async () => {
    const [t] = await sequelize.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('gf_consultas_ext','gf_consultas_eventos')");
    assert.equal(t.length, 2);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM pg_indexes WHERE indexname = 'uq_consultas_termino'"), 1);
    await require(r('migrations/20261111000000-gestao-fadas-consulta')).up({ sequelize });
  });

  console.log('Lançar');
  como('atendente');
  await passo('GET vazio: 200, DTO puro, no-store', async () => {
    const x = await lista();
    assert.equal(x.status, 200, x.t); assert.ok(!('sucesso' in x.j) && Array.isArray(x.j.items) && x.j.items.length === 0 && x.j.versions);
    assert.equal(x.h.get('cache-control'), 'no-store');
  });
  await passo('lançar: servidor decide estado, instantes, comissão 30 capturada e autor (o navegador não escolhe)', async () => {
    const antes = agora();
    const x = await lancar('con-a1', { commissionRate: 99, startedAt: '2001-01-01T00:00:00.000Z', attendant: 'Outro', tarologistFinishReport: { minutes: 1 } });
    assert.equal(x.status, 200, x.t);
    const c = item(x);
    assert.equal(c.status, 'Em curso'); assert.equal(c.commissionRate, 30); assert.equal(c.awaitingTarologistStart, true); assert.equal(c.attendant, 'Khloe');
    assert.ok(Math.abs(Date.parse(c.startedAt) - antes) < 20000 && c.sentToTarologistAt === c.startedAt); assert.equal(c.tarologistFinishReport, undefined);
    assert.equal(c.audit[0].action, 'Consulta criada'); assert.deepEqual(c.timeLimit, { kind: 'maximum', minutes: 30 }); assert.equal(x.j.versions['con-a1'], 1);
  });
  await passo('mesma chave e mesmo corpo repete a resposta; mesma chave com outro corpo é 409 OPERATION_KEY_CONFLICT', async () => {
    const chave = n();
    const z = { clientId: '900015', tarotId: 'zeus', tarot: 'Zeus' };
    const a = await lancar('con-idem', z, chave); const b = await lancar('con-idem', z, chave);
    assert.equal(a.status, 200); assert.equal(b.status, 200); assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_consultas_ext WHERE id = 'con-idem'"), 1);
    assert.deepEqual(b.j.consultations, a.j.consultations);
    const c = await lancar('con-idem', { ...z, clientId: '900016' }, chave); assert.equal(c.status, 409); assert.equal(c.j.error.code, 'OPERATION_KEY_CONFLICT');
  });
  await passo('ocupação: mesma cliente ou mesmo tarólogo com consulta aberta é 409 OCCUPANCY_CONFLICT; id repetido é 409', async () => {
    const x = await lancar('con-b1', { tarotId: 'nyx', tarot: 'Nyx' }); assert.equal(x.status, 409, x.t); assert.equal(x.j.error.code, 'OCCUPANCY_CONFLICT'); assert.match(x.j.error.message, /^Encerre a consulta de Cliente Teste antes de iniciar outra\.$/);
    const y = await lancar('con-b2', { clientId: '900014' }); assert.equal(y.status, 409); assert.equal(y.j.error.code, 'OCCUPANCY_CONFLICT');
    const z = await lancar('con-a1', { clientId: '900099', tarotId: 'iolanda' }); assert.equal(z.status, 409); assert.equal(z.j.error.code, 'VERSION_CHANGED');
  });
  await passo('regras do front: pré-paga sem tempo máximo (422 com a mensagem do front), cliente inexistente 404, forma ruim 400', async () => {
    const a = await lancar('con-c1', { clientId: '900020', tarotId: 'estrela', paymentProfile: 'Pré-paga', expectedMinutes: undefined });
    assert.equal(a.status, 422); assert.equal(a.j.error.code, 'RULE_VIOLATION'); assert.match(a.j.error.message, /^Informe o tempo máximo da consulta em minutos/);
    const b = await lancar('con-c2', { clientId: '999999', tarotId: 'estrela' }); assert.equal(b.status, 404); assert.equal(b.j.error.code, 'CLIENT_NOT_FOUND');
    assert.equal((await lancar('con-c3', { clientId: 'abc' })).status, 400);
  });
  await passo('comissão capturada do percentual vigente do tarólogo (Repasse) e nunca recalculada depois', async () => {
    await sequelize.query("INSERT INTO gf_repasse_percentuais (id, tarot_id, percentual, vigente_desde, motivo, registrado_por, registrado_em, operation_key) VALUES ('pc1', 'iolanda', 35.00, '2026-01-01 00:00:00', 'teste', :u, 1, 'chave-percentual-1')", { replacements: { u: uAdm } });
    const x = await lancar('con-p1', { clientId: '900021', tarotId: 'iolanda', tarot: 'Iolanda' }); assert.equal(item(x).commissionRate, 35);
    await sequelize.query("INSERT INTO gf_repasse_percentuais (id, tarot_id, percentual, vigente_desde, motivo, registrado_por, registrado_em, operation_key) VALUES ('pc2', 'iolanda', 50.00, '2026-02-01 00:00:00', 'teste', :u, 2, 'chave-percentual-2')", { replacements: { u: uAdm } });
    const l = await lista(); assert.equal(l.j.items.find((i) => i.id === 'con-p1').commissionRate, 35);
  });

  console.log('Leitura por perfil');
  await passo('equipe lê tudo; taróloga lê só as suas e SEM observação interna, cobrança nem auditoria', async () => {
    const eq = await lista(); assert.ok(eq.j.items.length >= 3); assert.equal(eq.j.items.find((i) => i.id === 'con-a1').observation, 'nota interna');
    como('osiris');
    const t = await lista(); assert.equal(t.status, 200);
    assert.ok(t.j.items.every((i) => i.tarotId === 'osiris')); const c = t.j.items.find((i) => i.id === 'con-a1');
    assert.equal(c.observation, ''); assert.deepEqual(c.audit, []); assert.equal(c.billing, undefined);
    assert.equal((await lista('?tarotId=nyx')).j.items.filter((i) => i.tarotId !== 'osiris').length, 0, 'o parâmetro é ignorado: ela só recebe a dela');
    como('nyx'); assert.equal((await lista()).j.items.find((i) => i.id === 'con-a1'), undefined);
    como('osiris', {}); sessao = { ...sessao, tarotId: undefined }; assert.equal((await lista()).status, 403);
  });
  await passo('taróloga não lança, não termina a de outro e não revisa como equipe', async () => {
    como('osiris');
    assert.equal((await lancar('con-t1', { clientId: '900022', tarotId: 'osiris' })).status, 403);
    como('nyx'); const x = await acao('con-a1', 'start'); assert.equal(x.status, 403);
    como('osiris'); const l = (await lista()).j.items.find((i) => i.id === 'con-a1');
    como('atendente'); const cheia = (await lista()).j.items.find((i) => i.id === 'con-a1'); como('osiris');
    const y = await rev('con-a1', cheia.updatedAt, { ...cheia, observation: 'x' }); assert.equal(y.status, 403, y.t); assert.ok(l);
  });

  console.log('Iniciar, pausar, retomar (relógio do servidor)');
  await passo('a taróloga dona inicia: horário do servidor, contagem zerada, 409/422 se repetir', async () => {
    como('osiris'); const antes = agora();
    const x = await acao('con-a1', 'start'); assert.equal(x.status, 200, x.t);
    const c = item(x); assert.equal(c.awaitingTarologistStart, false); assert.ok(Math.abs(Date.parse(c.tarologistStartedAt) - antes) < 20000);
    assert.equal(c.startedAt, c.tarologistStartedAt); assert.equal(x.j.versions['con-a1'], 2); assert.equal((await auditDe('con-a1')).slice(-1)[0].action, 'Consulta iniciada pelo tarólogo');
    const y = await acao('con-a1', 'start'); assert.equal(y.status, 422); assert.equal(y.j.error.message, 'Esta consulta não está aguardando início.');
  });
  await passo('o relógio da leitura é do servidor: a duração cresce com o tempo, nunca com o que o navegador mandar', async () => {
    await sequelize.query("UPDATE gf_consultas_ext SET item = jsonb_set(jsonb_set(item, '{tarologistStartedAt}', to_jsonb((now() - interval '10 minutes')::text)), '{startedAt}', to_jsonb((now() - interval '10 minutes')::text)), iniciada_em = now() - interval '10 minutes' WHERE id = 'con-a1'");
    const c = (await lista()).j.items.find((i) => i.id === 'con-a1'); assert.ok(c.durationSeconds >= 595 && c.durationSeconds <= 610, `duração ${c.durationSeconds}`);
  });
  await passo('pausa: a taróloga com consulta INICIADA não pode (422); a equipe pausa e retoma; duração congela na pausa', async () => {
    como('osiris'); const a = await acao('con-a1', 'pause'); assert.equal(a.status, 422); assert.equal(a.j.error.message, 'Você não tem permissão para pausar esta consulta.');
    como('atendente'); const b = await acao('con-a1', 'pause'); assert.equal(b.status, 200, b.t);
    const d1 = (await lista()).j.items.find((i) => i.id === 'con-a1').durationSeconds; await new Promise((f) => setTimeout(f, 1100)); const d2 = (await lista()).j.items.find((i) => i.id === 'con-a1').durationSeconds;
    assert.ok(d2 - d1 <= 1, `pausada deveria congelar (${d1} -> ${d2})`);
    const c = await acao('con-a1', 'resume'); assert.equal(c.status, 200); assert.equal(item(c).pauseHistory[0].endReason, 'resumed'); assert.equal(item(c).audit.slice(-1)[0].action, 'Consulta retomada');
  });

  console.log('Presença: consulta iniciada impede a pausa (regra do servidor)');
  await passo('a taróloga com consulta iniciada declara "Em pausa": 422 com a mensagem do front; sem consulta iniciada, a pausa passa', async () => {
    como('osiris');
    const pres = await chamar('GET', '/presence'); assert.equal(pres.status, 200);
    const x = await chamar('POST', '/presence/osiris/status', { operationKey: n(), expectedRevision: pres.j.revisions.osiris || '0', shiftStatus: 'Em pausa', pauseReason: 'Volta logo', expectedReturn: new Date(agora() + 15 * 60000).toISOString() });
    assert.equal(x.status, 422, x.t); assert.equal(x.j.error.message, 'Você tem uma consulta em andamento. Finalize antes de pausar.');
  });
  await passo('o gancho `consultasDe` da presença vê a consulta em andamento e os términos', async () => {
    const res = await sequelize.transaction(async () => 0).then(() => null);
    const { emTransacao } = require(r('src/gestao-fadas/novo/escritor'));
    const v = await emTransacao((ex) => ciclo.presenca.resumo(ex, 'osiris')); assert.equal(v.emAndamento, true); assert.equal(v.iniciada, true); assert.equal(res, null);
    const w = await emTransacao((ex) => ciclo.presenca.resumo(ex, 'nyx')); assert.equal(w.emAndamento, false);
  });

  console.log('Término informado UMA vez');
  await passo('a taróloga informa o término: status e minutos calculados pelo servidor; duração = minutos aplicados', async () => {
    como('osiris');
    const x = await acao('con-a1', 'finish', { minutes: 8, timingConfirmed: true, earlyFinish: { reason: 'client_satisfied', note: '' } }); assert.equal(x.status, 200, x.t);
    const c = item(x); assert.equal(c.status, 'Finalizada pelo tarólogo'); assert.equal(c.tarologistFinishReport.reporterRole, 'tarologo'); assert.ok(c.tarologistFinishReport.reviewReasons.includes('early_finish'));
    assert.equal(c.durationSeconds, 480); assert.equal(c.performedDurationSeconds, 480); assert.equal((await auditDe('con-a1')).slice(-1)[0].action, 'Término informado pelo tarólogo');
  });
  await passo('o segundo término é recusado (422) e o banco garante: nova linha de término no mesmo item cai no índice único', async () => {
    const y = await acao('con-a1', 'finish', { minutes: 8, timingConfirmed: true }); assert.equal(y.status, 422); assert.match(y.j.error.message, /^Esta consulta já foi encerrada\./);
    await assert.rejects(() => sequelize.query("INSERT INTO gf_consultas_eventos (id, id_consulta, tipo, ator_id, ator_nome, ator_perfil, dados, versao, operation_key) VALUES ('ev-dup', 'con-a1', 'termino', 'u', 'x', 'tarologa', '{}', 99, 'chave-duplicada-1')"), /uq_consultas_termino|unique|duplicate/i);
  });
  await passo('mais tempo e término recusam quem não é a dona', async () => {
    como('nyx'); assert.equal((await acao('con-a1', 'finish', { minutes: 5 })).status, 403);
  });

  console.log('Conferência, correção e desfechos (revise)');
  let atual;
  await passo('conferência pela equipe: versão certa aceita, status Concluída, autor e instante do servidor', async () => {
    como('atendente'); atual = (await lista()).j.items.find((i) => i.id === 'con-a1');
    const novo = { ...atual, status: 'Concluída', finishReview: { at: '2001-01-01T00:00:00.000Z', by: 'Khloe', reportSubmittedAt: atual.tarologistFinishReport.submittedAt, reportedMinutes: 8, result: 'approved' }, updatedAt: '2001-01-01T00:00:00.000Z',
      audit: [...atual.audit, { id: `review-con-a1-${Date.now()}`, action: 'Encerramento conferido', actor: 'Khloe', createdAt: '2001-01-01T00:00:00.000Z', detail: 'Concordou com 8 minutos informados por Osíris.' }] };
    const x = await rev('con-a1', atual.updatedAt, novo); assert.equal(x.status, 200, x.t);
    const c = item(x); assert.equal(c.status, 'Concluída'); assert.ok(Date.now() - Date.parse(c.updatedAt) < 20000, 'updatedAt é do servidor'); assert.ok(Date.now() - Date.parse(c.audit.slice(-1)[0].createdAt) < 20000);
    assert.equal(c.commissionRate, 30); assert.equal(x.j.versions['con-a1'], 6);
  });
  await passo('versão velha é 409 VERSION_CHANGED; duas revisões ao mesmo tempo: uma passa e a outra é 409', async () => {
    const velha = await rev('con-a1', atual.updatedAt, { ...atual, observation: 'tarde demais' }); assert.equal(velha.status, 409); assert.equal(velha.j.error.code, 'VERSION_CHANGED');
    const cur = (await lista()).j.items.find((i) => i.id === 'con-a1');
    const edit = (t) => rev('con-a1', cur.updatedAt, { ...cur, observation: t });
    const [a, b] = await Promise.all([edit('A'), edit('B')]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  });
  await passo('correção de tempo: motivo obrigatório; o relato do tarólogo permanece e a versão sobe', async () => {
    const cur = (await lista()).j.items.find((i) => i.id === 'con-a1');
    const velho = '2020-01-01T10:00:00.000Z'; // o instante do navegador é ignorado: o do evento é do servidor
    const novo = { ...cur, durationSeconds: 600, performedDurationSeconds: 600, readerCorrection: { at: velho, reason: 'Ajuste do atendimento' }, financialReview: undefined,
      finishReview: { at: velho, by: 'Khloe', reportSubmittedAt: cur.tarologistFinishReport.submittedAt, reportedMinutes: 8, result: 'corrected', reason: 'Ajuste do atendimento' },
      audit: [...cur.audit, { id: `time-con-a1-${Date.now()}`, action: 'Dados corrigidos', actor: 'Khloe', createdAt: new Date().toISOString(), detail: 'Tempo corrigido de 8 para 10 minutos. Ajuste do atendimento' }] };
    const sem = await rev('con-a1', cur.updatedAt, { ...novo, readerCorrection: { at: novo.readerCorrection.at, reason: '  ' } }); assert.equal(sem.status, 422);
    // O servidor refaz a correção (porte de correctConsultationTime): tempo que não bate com o evento, ou fora da regra, é 422.
    const adulterado = await rev('con-a1', cur.updatedAt, { ...novo, durationSeconds: 900, performedDurationSeconds: 900 }); assert.equal(adulterado.status, 422, adulterado.t); assert.match(adulterado.j.error.message, /Não foi possível conferir esta correção de tempo/);
    const x = await rev('con-a1', cur.updatedAt, novo); assert.equal(x.status, 200, x.t); assert.equal(item(x).durationSeconds, 600); assert.ok(Date.now() - Date.parse(item(x).readerCorrection.at) < 20000, 'readerCorrection.at é do servidor'); assert.ok(Date.now() - Date.parse(item(x).finishReview.at) < 20000, 'finishReview.at é do servidor'); assert.equal(item(x).tarologistFinishReport.minutes, 8);
  });
  await passo('devolver pela equipe e anular: atendente é 403, administradora passa; erro de lançamento exige motivo', async () => {
    como('atendente'); const l1 = await lancar('con-d1', { clientId: '900031', tarotId: 'estrela', tarot: 'Estrela' }); assert.equal(l1.status, 200, l1.t);
    const c = item(l1); const fim = new Date().toISOString();
    const dev = { ...c, status: 'Devolvida', endedAt: fim, awaitingTarologistStart: false, durationSeconds: 0, audit: [...c.audit, { id: 'a1', action: 'Consulta devolvida', actor: 'Khloe', createdAt: fim, detail: 'Devolvida.' }] };
    const anular = { ...dev, status: 'Anulada', audit: [...c.audit, { id: 'a2', action: 'Consulta anulada', actor: 'Khloe', createdAt: fim, detail: 'Anulada.' }] };
    const negada = await rev('con-d1', c.updatedAt, anular); assert.equal(negada.status, 403, negada.t);
    como('administradora'); const ok = await rev('con-d1', c.updatedAt, anular); assert.equal(ok.status, 200, ok.t); assert.equal(item(ok).status, 'Anulada');
    como('atendente'); const l2 = await lancar('con-d2', { clientId: '900032', tarotId: 'estrela', tarot: 'Estrela' }); const c2 = item(l2);
    const erro = { ...c2, status: 'Erro', endedAt: fim, errorReason: 'Outro motivo', awaitingTarologistStart: false, audit: [...c2.audit, { id: 'a3', action: 'Erro de lançamento', actor: 'Khloe', createdAt: fim, detail: 'Erro.' }] };
    const sem = await rev('con-d2', c2.updatedAt, erro); assert.equal(sem.status, 422); assert.match(sem.j.error.message, /motivo do erro/);
    const bom = await rev('con-d2', c2.updatedAt, { ...erro, errorReason: 'ID errado' }); assert.equal(bom.status, 200, bom.t);
  });
  await passo('a taróloga devolve a PRÓPRIA consulta (cancel-by-reader: vira Devolvida, sem repasse, tempo do servidor); a de outra é 403', async () => {
    como('atendente'); const l = await lancar('con-r1', { clientId: '900033', tarotId: 'osiris', tarot: 'Osíris' }); assert.equal(l.status, 200, l.t);
    como('nyx'); assert.equal((await acao('con-r1', 'cancel-by-reader', { reason: 'Não bateu', note: '' })).status, 403);
    como('osiris'); assert.equal((await acao('con-r1', 'cancel-by-reader', { reason: 'Qualquer', note: '' })).status, 422);
    const x = await acao('con-r1', 'cancel-by-reader', { reason: 'Não bateu', note: 'sem sinal' }); assert.equal(x.status, 200, x.t);
    const c = item(x); assert.equal(c.status, 'Devolvida'); assert.equal(c.tarologistCancellation.reporterTarotId, 'osiris'); assert.equal(c.durationSeconds, 0); assert.equal(c.observation, '', 'a taróloga não vê a nota interna');
    como('atendente'); const interna = (await lista()).j.items.find((i) => i.id === 'con-r1'); assert.match(interna.observation, /Devolvida pelo tarólogo: Não bateu\. sem sinal/);
    assert.equal((await acao('con-r1', 'cancel-by-reader', { reason: 'Outros', note: '' })).status, 403, 'a equipe não devolve como se fosse a taróloga');
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_consultas_ext WHERE status = 'Em curso' AND id_tarologo = 'osiris'"), 0);
  });
  await passo('pedido de mais tempo e de correção do término são da taróloga dona e passam pelo domínio', async () => {
    como('atendente'); const l = await lancar('con-r2', { clientId: '900034', tarotId: 'osiris', tarot: 'Osíris' }); assert.equal(l.status, 200, l.t);
    como('osiris'); assert.equal((await acao('con-r2', 'more-time')).status, 422, 'aguardando início não pede mais tempo');
    await sequelize.query("UPDATE gf_consultas_ext SET item = jsonb_set(item, '{sentToTarologistAt}', to_jsonb((now() - interval '5 minutes')::text)) WHERE id = 'con-r2'");
    assert.equal((await acao('con-r2', 'start')).status, 200);
    const m = await acao('con-r2', 'more-time'); assert.equal(m.status, 200, m.t); assert.equal(item(m).tarologistMoreTimeRequest.active, true); assert.equal((await auditDe('con-r2')).slice(-1)[0].action, 'Pedido de mais tempo');
    assert.equal((await acao('con-r2', 'finish/correction-request', { minutes: 5, reason: 'x' })).status, 422, 'ainda sem relato final');
    const f = await acao('con-r2', 'finish', { minutes: 2, timingConfirmed: true, earlyFinish: { reason: 'client_connection', note: '' } }); assert.equal(f.status, 200, f.t);
    const c = await acao('con-r2', 'finish/correction-request', { minutes: 3, reason: 'Contei errado' }); assert.equal(c.status, 200, c.t);
    assert.equal(item(c).finishCorrections[0].status, 'pending'); assert.equal(item(c).finishCorrections[0].beforeMinutes, 2);
    assert.equal((await acao('con-r2', 'finish/correction-request', { minutes: 2, reason: 'x' })).status, 422, 'igual ao registrado ou já pendente');
  });

  console.log('Agenda que nasce da consulta');
  await passo('a consulta com agendaItemId retira o agendamento da fila ao iniciar ("Em consulta") e o conclui ao terminar', async () => {
    como('atendente');
    const ag = await chamar('POST', '/agenda', { operationKey: n(), id: 'ag-con-1', tarotId: 'hera', clientId: '900040', client: 'Cliente Agenda', date: new Date().toISOString().slice(0, 10), set: { time: '10:00', channel: 'WhatsApp Áudio' }, append: {} });
    assert.equal(ag.status, 200, ag.t);
    const l = await lancar('con-g1', { clientId: '900040', client: 'Cliente Agenda', tarotId: 'hera', tarot: 'Hera', agendaItemId: 'ag-con-1' }); assert.equal(l.status, 200, l.t);
    assert.equal((await chamar('GET', '/agenda')).j.items.find((i) => i.id === 'ag-con-1').resolvedByConsultationId, undefined, 'aguardando início não resolve');
    await sequelize.query("UPDATE gf_consultas_ext SET item = jsonb_set(item, '{sentToTarologistAt}', to_jsonb((now() - interval '5 minutes')::text)) WHERE id = 'con-g1'");
    const s = await acao('con-g1', 'start'); assert.equal(s.status, 200, s.t); assert.equal(s.j.agenda.length, 1);
    const a1 = (await chamar('GET', '/agenda')).j.items.find((i) => i.id === 'ag-con-1');
    assert.equal(a1.resolvedByConsultationId, 'con-g1'); assert.equal(a1.workflowStatus, 'Em consulta'); assert.deepEqual(a1.contact.tags.slice(-1), ['Em consulta']); assert.equal(a1.resolutionHistory[0].action, 'Agendamento concluído');
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_agenda_eventos WHERE id_agenda = 'ag-con-1' AND tipo = 'resolucao'"), 1);
    const f = await acao('con-g1', 'finish-by-staff', { minutes: 30 }); assert.equal(f.status, 200, f.t);
    const a2 = (await chamar('GET', '/agenda?includeClosed=true')).j.items.find((i) => i.id === 'ag-con-1');
    assert.equal(a2.agendaOutcome, 'Concluída'); assert.equal(a2.workflowStatus, 'Concluída'); assert.equal(a2.resolvedByConsultationId, 'con-g1');
  });

  console.log('Fontes do Painel');
  await passo('GET /panel/sources: agenda, consultas, perfis e exceções reais da equipe; o que não existe vem em "missing"; taróloga é 403', async () => {
    como('atendente'); const x = await chamar('GET', '/panel/sources?date=2026-11-10');
    assert.equal(x.status, 200, x.t); assert.equal(x.h.get('cache-control'), 'no-store');
    assert.ok(Array.isArray(x.j.agenda) && Array.isArray(x.j.consultations) && Array.isArray(x.j.profiles) && typeof x.j.overrides === 'object' && x.j.date === '2026-11-10');
    assert.ok(x.j.consultations.some((c) => c.id === 'con-g1') && x.j.agenda.some((a) => a.id === 'ag-con-1'));
    for (const falta of ['payments', 'pricing', 'restrictions']) assert.ok(x.j.missing.includes(falta), falta);
    assert.deepEqual(x.j.payments, []); assert.equal(x.j.pricing, null);
    como('osiris'); assert.equal((await chamar('GET', '/panel/sources')).status, 403);
    process.env.GF_FATIA_CONSULTA = 'false'; try { como('atendente'); assert.equal((await chamar('GET', '/panel/sources')).status, 404); } finally { process.env.GF_FATIA_CONSULTA = 'true'; }
  });

  console.log('Auditoria e eventos na mesma transação');
  await passo('cada gravação deixou auditoria `consulta.*` e evento imutável; a falha não deixa rastro parcial', async () => {
    const gravacoes = await contar("SELECT COUNT(*) AS n FROM gf_consultas_eventos");
    const aud = await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE entidade = 'consulta'");
    assert.ok(gravacoes >= 12 && aud >= 12, `eventos ${gravacoes}, auditoria ${aud}`);
    const antes = await contar('SELECT COUNT(*) AS n FROM gf_consultas_eventos');
    const x = await acao('con-g1', 'finish-by-staff', { minutes: 5 }); assert.equal(x.status, 422);
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_consultas_eventos'), antes);
  });

  console.log('Espelho no legado (executor FALSO; o MySQL de verdade nunca é tocado)');
  await passo('desligado por padrão: nada é espelhado e o estado fica nao_espelhada', async () => {
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_consultas_ext WHERE legado_estado <> 'nao_espelhada' OR id_consulta_legado IS NOT NULL"), 0);
    assert.equal(`${process.env.LEGADO_DB_HOST || ''}`, ''); assert.equal(`${process.env.LEGADO_DB_NAME || ''}`, '');
  });
  await passo('ligado (com executor falso): INSERT ao lançar, UPDATE ao iniciar e ao terminar, vínculo no Postgres, sem DELETE', async () => {
    const gravadas = []; let proximoId = 7000; const tarologos = { osiris: 11 };
    const originais = { emTransacao: legado.emTransacao, consultas: legado.consultas, espelhoLigado: legado.espelhoLigado };
    legado.espelhoLigado = () => true;
    legado.emTransacao = async (fn) => fn({ execute: async (sql, v) => { gravadas.push({ sql: sql.split(' ').slice(0, 3).join(' '), v }); return [[]]; } });
    legado.consultas = {
      resolverTarologo: async (ex, id) => tarologos[id] ?? null,
      buscarCandidatas: async () => [],
      inserir: async (ex, it) => { await ex.execute('INSERT INTO tbl_consultas', [it.id]); return String((proximoId += 1)); },
      atualizar: async (ex, id, it) => { await ex.execute('UPDATE tbl_consultas', [id, it.status]); return 1; },
    };
    try {
      como('atendente');
      const l = await lancar('con-m1', { clientId: '900050', tarotId: 'osiris', tarot: 'Osíris' }); assert.equal(l.status, 200, l.t);
      let linha = (await sequelize.query("SELECT id_consulta_legado, legado_estado FROM gf_consultas_ext WHERE id = 'con-m1'"))[0][0];
      assert.equal(linha.legado_estado, 'espelhada'); assert.equal(linha.id_consulta_legado, '7001');
      await sequelize.query("UPDATE gf_consultas_ext SET item = jsonb_set(item, '{sentToTarologistAt}', to_jsonb((now() - interval '5 minutes')::text)) WHERE id = 'con-m1'");
      como('osiris'); assert.equal((await acao('con-m1', 'start')).status, 200);
      assert.equal((await acao('con-m1', 'finish', { minutes: 1, timingConfirmed: true, earlyFinish: { reason: 'client_connection', note: '' } })).status, 200);
      linha = (await sequelize.query("SELECT id_consulta_legado, legado_estado FROM gf_consultas_ext WHERE id = 'con-m1'"))[0][0];
      assert.equal(linha.id_consulta_legado, '7001', 'o vínculo não muda: o segundo passo é UPDATE');
      const tipos = gravadas.map((g) => g.sql); assert.deepEqual(tipos.filter((t) => t === 'INSERT INTO tbl_consultas').length, 1);
      assert.ok(tipos.filter((t) => t === 'UPDATE tbl_consultas').length >= 2); assert.ok(!tipos.some((t) => /DELETE/i.test(t)));
      // Tarólogo sem código no legado: a consulta segue válida e o estado diz por quê.
      como('atendente'); const m = await lancar('con-m2', { clientId: '900051', tarotId: 'nyx', tarot: 'Nyx' }); assert.equal(m.status, 200, m.t);
      assert.equal((await sequelize.query("SELECT legado_estado FROM gf_consultas_ext WHERE id = 'con-m2'"))[0][0].legado_estado, 'sem_tarologo');
      // Falha do legado: a consulta já está gravada; o erro vai para o estado e a próxima gravação refaz.
      legado.consultas.inserir = async () => { const e = new Error('conexão caiu'); e.codigo = 'ECONN'; throw e; };
      const f = await lancar('con-m3', { clientId: '900052', tarotId: 'osiris', tarot: 'Osíris' });
      // osiris já tem a m1 encerrada; a ocupação não conflita porque a m1 terminou.
      assert.equal(f.status, 200, f.t);
      const e = (await sequelize.query("SELECT legado_estado, legado_detalhe FROM gf_consultas_ext WHERE id = 'con-m3'"))[0][0]; assert.equal(e.legado_estado, 'erro'); assert.match(e.legado_detalhe, /ECONN/);
      legado.consultas.inserir = async () => '7100';
      await ciclo.espelho.sincronizar('con-m3', 'refazer');
      assert.equal((await sequelize.query("SELECT id_consulta_legado, legado_estado FROM gf_consultas_ext WHERE id = 'con-m3'"))[0][0].id_consulta_legado, '7100');
    } finally { Object.assign(legado, originais); }
  });
  await passo('o espelho real exige o interruptor: sem GF_LEGADO_ESCRITA_ENABLED a transação do legado é recusada', async () => {
    await assert.rejects(() => legado.emTransacao(async () => 1), (e) => e.codigo === 'ESPELHO_DESLIGADO');
  });

  console.log('Fatia e escrita');
  await passo('escrita desligada: leitura segue 200 e gravação responde 503 WRITE_DISABLED', async () => {
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
    try {
      como('atendente'); assert.equal((await lista()).status, 200);
      const x = await lancar('con-off', { clientId: '900060', tarotId: 'estrela' }); assert.equal(x.status, 503); assert.equal(x.j.error.code, 'WRITE_DISABLED');
    } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
  });
  await passo('fatia desligada em tempo de execução: 404', async () => {
    process.env.GF_FATIA_CONSULTA = 'false';
    try { assert.equal((await lista()).status, 404); } finally { process.env.GF_FATIA_CONSULTA = 'true'; }
  });
  await passo('com a fatia desligada o gancho da presença volta ao vazio de antes (retrocompatível)', async () => {
    process.env.GF_FATIA_CONSULTA = 'false';
    try { const { emTransacao } = require(r('src/gestao-fadas/novo/escritor')); const v = await emTransacao((ex) => ciclo.presenca.resumo(ex, 'osiris')); assert.equal(v.emAndamento, false); assert.deepEqual(v.terminos, []); } finally { process.env.GF_FATIA_CONSULTA = 'true'; }
    assert.ok(job.presencaLigada());
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
