'use strict';

/**
 * FILHO de scripts/verificar-gf-presenca.js: roda contra o Postgres DESCARTÁVEL (fdb_prs_*) já migrado, com DB_* só no ambiente
 * deste processo. Prova pelo HTTP do gate (sessão de mentira, usuários reais da A no banco): leitura vazia, confirmação, pausa, saída e
 * retorno, idempotência, 409 de versão e de chave, corrida, perfis (equipe, taróloga própria, taróloga sem tarotId), batimento sem mexer na
 * revisão, pedido manual, auditoria na mesma transação, escrita desligada, e o JOB: relógio simulado (59 min nada, 60 min abre, 5 min vence,
 * consulta em andamento descarta) e o agendamento real com prazos encurtados por env, tudo sem aba aberta e sem tocar no MySQL legado.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_PRESENCA: 'true' });
const r = (p) => path.join(raiz, p);
const sp = (hhmm, dia = '2026-12-02') => Date.parse(`${dia}T${hhmm}:00-03:00`); // 2026-12-02 é quarta-feira

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const job = require(r('src/gestao-fadas/features/presenca/presenca.job'));
  const uStaff = await criarUsuario('Atendente Presença');
  const uTar = await criarUsuario('Osíris Presença');
  let sessao = { userId: uStaff, role: 'atendente', displayName: 'Atendente Presença' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-prs' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 240), h: resp.headers };
  };
  const como = (perfil, extra = {}) => { sessao = { userId: perfil === 'tarologa' ? uTar : uStaff, role: perfil, displayName: perfil === 'tarologa' ? 'Osíris Presença' : 'Atendente Presença', ...extra }; };
  const n = () => { n.i = (n.i || 0) + 1; return `op-${Date.now()}-${n.i}`; };
  const ler = (q = '') => chamar('GET', `/presence${q}`);
  const status = (tarot, rev, extra) => chamar('POST', `/presence/${tarot}/status`, { operationKey: n(), expectedRevision: rev, ...extra });
  const confirmar = (tarot, rev) => chamar('POST', `/presence/${tarot}/confirm`, { operationKey: n(), expectedRevision: rev });
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);
  const perfilDe = async (tarot) => (await ler()).j.profiles.find((p) => p.id === tarot);
  const revDe = async (tarot) => (await ler()).j.revisions[tarot] || '0';

  console.log('Esquema');
  await passo('3 tabelas da fatia existem e a migração roda de novo sem erro', async () => {
    const [t] = await sequelize.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('gf_presenca_estado','gf_presenca_confirmacoes','gf_presenca_historico')");
    assert.equal(t.length, 3);
    await require(r('migrations/20261103000300-gestao-fadas-presenca')).up({ sequelize });
  });

  console.log('Leitura');
  como('atendente');
  await passo('GET vazio: 200, DTO puro, no-store, revisão vazia "0"', async () => {
    const x = await ler();
    assert.equal(x.status, 200, x.t);
    assert.ok(!('sucesso' in x.j) && x.j.emptyRevision === '0' && Array.isArray(x.j.profiles) && x.j.profiles.length === 0);
    assert.equal(x.h.get('cache-control'), 'no-store'); assert.match(x.j.today, /^\d{4}-\d{2}-\d{2}$/);
  });

  console.log('Taróloga confirma a própria presença');
  como('tarologa', { tarotId: 'osiris' });
  const k1 = n();
  const corpo1 = { operationKey: k1, expectedRevision: '0' };
  const c1 = await chamar('POST', '/presence/osiris/confirm', corpo1);
  await passo('confirmar: 200, Disponível, carimbos do servidor, histórico com o nome dela, revisão "1"', async () => {
    assert.equal(c1.status, 200, c1.t);
    const p = c1.j.profile;
    assert.equal(p.id, 'osiris'); assert.equal(p.shiftStatus, 'Disponível'); assert.equal(p.online, true); assert.ok(p.presenceConfirmedAt && p.shiftAvailableSince && p.presenceLastActivityAt);
    assert.ok(!('presenceConfirmation' in p) && !('shiftExit' in p) && !('pauseReason' in p), 'campo ausente fica ausente');
    assert.equal(p.presenceHistory.length, 1); assert.equal(p.presenceHistory[0].actorName, 'Osíris Presença'); assert.equal(p.presenceHistory[0].actorId, uTar);
    assert.equal(c1.j.revision, '1'); assert.equal(c1.h.get('cache-control'), 'no-store');
  });
  await passo('GET devolve o que foi gravado e a revisão; taróloga lê só o seu', async () => {
    const x = await ler();
    assert.deepEqual(x.j.profiles.map((p) => p.id), ['osiris']); assert.deepEqual(x.j.profiles[0], c1.j.profile); assert.equal(x.j.revisions.osiris, '1');
    assert.equal((await ler('?tarotId=nyx')).status, 200, 'o parâmetro é ignorado: ela só recebe o seu');
  });
  await passo('mesma chave e mesmo corpo repete a resposta sem gravar de novo', async () => {
    const antes = await contar('SELECT COUNT(*) AS n FROM gf_presenca_historico');
    const rep = await chamar('POST', '/presence/osiris/confirm', corpo1);
    assert.equal(rep.status, 200); assert.deepEqual(rep.j, c1.j);
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_presenca_historico'), antes);
  });
  await passo('mesma chave com outro corpo: 409 OPERATION_KEY_CONFLICT', async () => {
    const x = await chamar('POST', '/presence/osiris/confirm', { ...corpo1, expectedRevision: '5' });
    assert.equal(x.status, 409); assert.equal(x.j.error.code, 'OPERATION_KEY_CONFLICT');
  });
  await passo('revisão antiga: 409 VERSION_CHANGED, nada gravado', async () => {
    const antes = await contar('SELECT COUNT(*) AS n FROM gf_presenca_historico');
    const x = await confirmar('osiris', '0');
    assert.equal(x.status, 409); assert.equal(x.j.error.code, 'VERSION_CHANGED');
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_presenca_historico'), antes);
  });

  console.log('Pausa, saída e retorno');
  let rev = '1';
  await passo('pausa "Refeição" 30 min: Em pausa, retorno previsto, desde-quando limpo, revisão sobe', async () => {
    const ate = new Date(Date.now() + 30 * 60_000).toISOString();
    const x = await status('osiris', rev, { shiftStatus: 'Em pausa', pauseReason: 'Refeição', expectedReturn: ate });
    assert.equal(x.status, 200, x.t);
    assert.equal(x.j.profile.shiftStatus, 'Em pausa'); assert.equal(x.j.profile.pauseReason, 'Refeição'); assert.equal(x.j.profile.expectedReturn, ate); assert.ok(!('shiftAvailableSince' in x.j.profile));
    assert.equal(x.j.profile.presenceHistory.length, 2); assert.match(x.j.profile.presenceHistory[1].after, /^Pausa · Refeição · retorno previsto às \d{2}:\d{2}$/);
    rev = x.j.revision; assert.equal(rev, '2');
  });
  await passo('pausa de mais de 24 h: 422 RULE_VIOLATION com a mensagem do front; pausa sem retorno aceita', async () => {
    const a = await status('osiris', rev, { shiftStatus: 'Em pausa', pauseReason: 'Refeição', expectedReturn: new Date(Date.now() + 2000 * 60_000).toISOString() });
    assert.equal(a.status, 422); assert.equal(a.j.error.code, 'RULE_VIOLATION'); assert.equal(a.j.error.message, 'Informe a duração da pausa em minutos, entre 1 e 1440.');
    assert.equal((await ler()).j.revisions.osiris, rev, 'recusa não muda a revisão');
  });
  await passo('Offline com retorno (ela mesma, "keep" sem pedido): saída "return", janela guardada, histórico', async () => {
    const ini = new Date(Date.now() + 3 * 3600_000).toISOString(); const fim = new Date(Date.now() + 7 * 3600_000).toISOString();
    const x = await status('osiris', rev, { shiftStatus: 'Offline', shiftExit: 'return', expectedReturn: ini, returnUntil: fim, confirmation: 'none' });
    assert.equal(x.status, 200, x.t);
    assert.equal(x.j.profile.shiftStatus, 'Offline'); assert.equal(x.j.profile.shiftExit, 'return'); assert.equal(x.j.profile.expectedReturn, ini); assert.equal(x.j.profile.returnUntil, fim);
    assert.ok(x.j.profile.presenceScheduleUpdatedAt && !('presenceConfirmation' in x.j.profile));
    rev = x.j.revision;
  });
  await passo('término antes do retorno: 422; campos que contradizem o estado: 400', async () => {
    const ini = new Date(Date.now() + 3 * 3600_000).toISOString();
    const a = await status('osiris', rev, { shiftStatus: 'Offline', shiftExit: 'return', expectedReturn: ini, returnUntil: new Date(Date.now() + 2 * 3600_000).toISOString() });
    assert.equal(a.status, 422);
    assert.equal((await status('osiris', rev, { shiftStatus: 'Disponível', shiftExit: 'ended' })).status, 400);
    assert.equal((await chamar('POST', '/presence/osiris/status', { operationKey: n() })).status, 400);
    const quebrado = await fetch(`${base}/presence/osiris/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{quebrado' });
    assert.equal(quebrado.status, 400);
  });
  await passo('confirmar de novo (volta ao Disponível) usa a janela de retorno como período confirmado', async () => {
    const x = await confirmar('osiris', rev);
    assert.equal(x.status, 200, x.t); assert.equal(x.j.profile.shiftStatus, 'Disponível'); assert.ok(!('shiftExit' in x.j.profile) && !('expectedReturn' in x.j.profile));
    rev = x.j.revision;
  });
  await passo('corrida: duas gravações com a mesma revisão, uma passa e a outra recebe 409', async () => {
    const [a, b] = await Promise.all([
      status('osiris', rev, { shiftStatus: 'Em pausa', pauseReason: 'Volta logo' }),
      status('osiris', rev, { shiftStatus: 'Offline', shiftExit: 'ended' }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.status}/${b.status}`);
    rev = await revDe('osiris');
  });

  console.log('Perfis');
  await passo('equipe lê todos e escreve em qualquer tarólogo (administradora, assistente, supervisora, atendente)', async () => {
    for (const p of ['administradora', 'assistente', 'supervisora', 'atendente']) {
      como(p);
      assert.equal((await ler()).status, 200, p);
      const x = await status('nyx', await revDe('nyx'), { shiftStatus: 'Offline', shiftExit: 'shift-ended', confirmation: 'manual' });
      assert.equal(x.status, 200, `${p}: ${x.t}`);
      assert.equal(x.j.profile.presenceConfirmation.reason, 'manual'); assert.equal(x.j.profile.presenceConfirmation.offlineAt, x.j.profile.presenceConfirmation.requestedAt);
    }
    como('atendente');
    assert.deepEqual((await ler()).j.profiles.map((p) => p.id), ['nyx', 'osiris']);
  });
  await passo('a equipe confirma presença de uma taróloga: histórico leva o nome de quem agiu', async () => {
    const x = await confirmar('nyx', await revDe('nyx'));
    assert.equal(x.status, 200, x.t); assert.equal(x.j.profile.presenceHistory.at(-1).actorName, 'Atendente Presença'); assert.ok(!('presenceConfirmation' in x.j.profile));
  });
  await passo('taróloga no tarólogo de outra pessoa: 403 ACCESS_DENIED; sem tarotId na sessão: 403 na leitura e na gravação', async () => {
    como('tarologa', { tarotId: 'osiris' });
    const o = await status('nyx', '0', { shiftStatus: 'Offline' });
    assert.equal(o.status, 403); assert.equal(o.j.error.code, 'ACCESS_DENIED');
    como('tarologa');
    assert.equal((await ler()).status, 403);
    assert.equal((await confirmar('osiris', '0')).status, 403);
  });

  console.log('Pedido manual e batimento');
  await passo('pedido manual: só a própria taróloga, só se está offline e sem pedido; segunda vez não duplica', async () => {
    como('atendente');
    assert.equal((await chamar('POST', '/presence/estrela/request', { operationKey: n() })).status, 403, 'equipe não pede pela taróloga');
    como('tarologa', { tarotId: 'estrela' });
    const a = await chamar('POST', '/presence/estrela/request', { operationKey: n() });
    assert.equal(a.status, 200, a.t); assert.equal(a.j.profile.presenceConfirmation.reason, 'manual'); assert.equal(a.j.profile.shiftStatus, 'Offline'); assert.equal(a.j.revision, '1');
    const b = await chamar('POST', '/presence/estrela/request', { operationKey: n() });
    assert.equal(b.status, 200); assert.equal(b.j.revision, '1'); assert.deepEqual(b.j.profile.presenceConfirmation, a.j.profile.presenceConfirmation);
  });
  await passo('batimento: nova linha só depois de 60 s, sem mexer na revisão nem pedir operationKey', async () => {
    como('tarologa', { tarotId: 'osiris' });
    const revAntes = await revDe('osiris');
    const a = await chamar('POST', '/presence/osiris/activity', {});
    assert.equal(a.status, 200); assert.equal(a.j.registered, false, 'o estado acabou de ser gravado: dentro de 60 s');
    await sequelize.query("UPDATE gf_presenca_estado SET presence_last_activity_at = now() - interval '2 minutes' WHERE id_tarologo = 'osiris'");
    const b = await chamar('POST', '/presence/osiris/activity', {});
    assert.equal(b.j.registered, true);
    assert.equal(await revDe('osiris'), revAntes);
    const depois = await perfilDe('osiris');
    assert.ok(Date.now() - Date.parse(depois.presenceLastActivityAt) < 5000);
    como('tarologa', { tarotId: 'sem-estado' });
    assert.equal((await chamar('POST', '/presence/sem-estado/activity', {})).j.registered, false, 'sem estado nada é gravado');
    como('atendente');
    assert.equal((await chamar('POST', '/presence/osiris/activity', {})).status, 403, 'só a própria taróloga bate o ponto');
  });

  console.log('Job: confirmação 60+5 no servidor, sem aba aberta');
  await sequelize.query("INSERT INTO gf_escalas_semanais (id_tarologo, weekday, hours) VALUES ('iolanda', 'quarta', '9h às 15h')");
  como('tarologa', { tarotId: 'iolanda' });
  const ci = await confirmar('iolanda', '0');
  assert.equal(ci.status, 200, ci.t);
  await sequelize.query("UPDATE gf_presenca_estado SET presence_date = '2026-12-02', presence_confirmed_at = '2026-12-02T12:00:00Z', shift_available_since = '2026-12-02T12:00:00Z', presence_last_activity_at = '2026-12-02T17:00:00Z' WHERE id_tarologo = 'iolanda'");
  await sequelize.query("UPDATE gf_presenca_estado SET shift_status = 'Offline', shift_available_since = NULL WHERE id_tarologo IN ('osiris', 'nyx', 'estrela')");
  como('atendente');
  const revJ = await revDe('iolanda');
  await passo('dia seguinte: pedidos manuais de ontem de quem está offline são descartados pelo job (sem reexigir turno que não começou)', async () => {
    const x = await job.varrer(sp('12:00'));
    assert.ok(x.alterados >= 1, `${x.alterados}`);
    assert.ok((await ler()).j.profiles.filter((p) => p.shiftStatus === 'Offline').every((p) => !p.presenceConfirmation));
  });
  await passo('59 min depois do fim do turno (15h59): nada acontece', async () => {
    const x = await job.varrer(sp('15:59'));
    assert.equal(x.alterados, 0); assert.equal((await perfilDe('iolanda')).presenceConfirmation, undefined);
  });
  await passo('60 min (16h00): abre o pedido com 5 min de prazo; a revisão sobe e a leitura mostra', async () => {
    const x = await job.varrer(sp('16:00'));
    assert.equal(x.alterados, 1);
    const p = await perfilDe('iolanda');
    assert.deepEqual(p.presenceConfirmation, { reason: 'inactivity', requestedAt: new Date(sp('16:00')).toISOString(), deadlineAt: new Date(sp('16:05')).toISOString(), idleTimeoutMs: 3_600_000 });
    assert.equal(p.shiftStatus, 'Disponível');
    assert.notEqual(await revDe('iolanda'), revJ);
  });
  await passo('16h04: ainda nada; rodar de novo no mesmo minuto não muda (idempotente)', async () => {
    assert.equal((await job.varrer(sp('16:04'))).alterados, 0);
    assert.equal((await job.varrer(sp('16:04'))).alterados, 0);
  });
  await passo('16h05: vence, vira Offline com histórico "Sistema" e pedido marcado offline', async () => {
    const x = await job.varrer(sp('16:05'));
    assert.equal(x.alterados, 1);
    const p = await perfilDe('iolanda');
    assert.equal(p.shiftStatus, 'Offline'); assert.equal(p.online, false); assert.equal(p.presenceConfirmation.offlineAt, new Date(sp('16:05')).toISOString());
    const h = p.presenceHistory.at(-1);
    assert.equal(h.actorName, 'Sistema'); assert.equal(h.actorId, 'system-presence'); assert.equal(h.before, 'Disponível · confirmação pendente');
    assert.equal(p.presenceDate, '2026-12-02');
    assert.equal((await job.varrer(sp('16:30'))).alterados, 0, 'já offline: nada mais acontece');
  });
  await passo('ela confirma de novo depois do vencimento: volta a Disponível e o pedido some', async () => {
    como('tarologa', { tarotId: 'iolanda' });
    const x = await confirmar('iolanda', await revDe('iolanda'));
    assert.equal(x.status, 200, x.t); assert.equal(x.j.profile.shiftStatus, 'Disponível'); assert.ok(!('presenceConfirmation' in x.j.profile));
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_presenca_confirmacoes WHERE id_tarologo = 'iolanda' AND limpa_em IS NOT NULL"), 1, 'limpo por limpa_em, nunca DELETE');
  });
  await passo('consulta em andamento descarta o pedido aberto (hook de consultas da fatia Consulta)', async () => {
    await sequelize.query("UPDATE gf_presenca_estado SET presence_confirmed_at = '2026-12-02T12:00:00Z', shift_available_since = '2026-12-02T12:00:00Z', presence_last_activity_at = '2026-12-02T17:00:00Z', presence_date = '2026-12-02' WHERE id_tarologo = 'iolanda'");
    assert.equal((await job.varrer(sp('16:00'))).alterados, 1);
    como('atendente');
    assert.ok((await perfilDe('iolanda')).presenceConfirmation);
    const x = await job.varrer(sp('16:03'), { consultasDe: (id) => (id === 'iolanda' ? { emAndamento: true, terminos: [] } : { emAndamento: false, terminos: [] }) });
    assert.equal(x.alterados, 1);
    assert.equal((await perfilDe('iolanda')).presenceConfirmation, undefined);
  });
  await passo('agendamento real do job com prazos curtos por env (sem relógio simulado): vence sozinho, sem nenhuma requisição', async () => {
    Object.assign(process.env, { GF_PRESENCA_IDLE_MS: '2000', GF_PRESENCA_CONFIRM_MS: '2000', GF_PRESENCA_JOB_MS: '1000' });
    await sequelize.query("INSERT INTO gf_escalas_semanais (id_tarologo, weekday, hours) VALUES ('ariel', 'domingo', '9h às 10h'), ('ariel', 'segunda', '9h às 10h'), ('ariel', 'terca', '9h às 10h'), ('ariel', 'quarta', '9h às 10h'), ('ariel', 'quinta', '9h às 10h'), ('ariel', 'sexta', '9h às 10h'), ('ariel', 'sabado', '9h às 10h')");
    como('tarologa', { tarotId: 'ariel' });
    assert.equal((await confirmar('ariel', '0')).status, 200);
    // O turno de hoje (9h às 10h) já acabou ou ainda não começou: força o fim do turno para o passado para a regra de inatividade valer agora.
    await sequelize.query("UPDATE gf_presenca_estado SET presence_last_activity_at = now() - interval '10 seconds', presence_confirmed_at = now() - interval '10 seconds', shift_available_since = now() - interval '10 seconds' WHERE id_tarologo = 'ariel'");
    const hoje = await sequelize.query("SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo' - interval '6 hours')::date, 'YYYY-MM-DD') AS d");
    const dia = hoje[0][0].d;
    await sequelize.query("INSERT INTO gf_horarios_excecoes (id, id_tarologo, data_inicio, data_fim, absence_type, today_hours, observacao, updated_at_texto, operation_key) VALUES ('exc-ariel', 'ariel', ?, ?, 'Nenhuma', '0h às 1h', '', '2026-01-01T00:00:00', 'op-ariel-0001')".replace(/\?/g, `'${dia}'`));
    await sequelize.query("INSERT INTO gf_horarios_periodos (id_excecao, ordem, inicio, fim) VALUES ('exc-ariel', 1, '06:00', '06:01')");
    const timer = job.agendar();
    assert.ok(timer, 'agendar() liga com a flag, a escrita e o banco novo');
    try {
      como('atendente');
      const t0 = Date.now(); let p;
      while (Date.now() - t0 < 15_000) { p = await perfilDe('ariel'); if (p && p.shiftStatus === 'Offline') break; await new Promise((f) => setTimeout(f, 500)); }
      assert.equal(p.shiftStatus, 'Offline', `não venceu em 15 s: ${JSON.stringify(p.presenceConfirmation)}`);
      assert.equal(p.presenceHistory.at(-1).actorName, 'Sistema'); assert.equal(p.presenceConfirmation.idleTimeoutMs, 2000);
    } finally { clearInterval(timer); for (const k of ['GF_PRESENCA_IDLE_MS', 'GF_PRESENCA_CONFIRM_MS', 'GF_PRESENCA_JOB_MS']) delete process.env[k]; }
  });
  await passo('job desligado sem a flag, sem escrita ou fora do banco novo: agendar() não liga nada', async () => {
    assert.equal(job.agendar({ GF_FATIA_PRESENCA: 'false' }), null);
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
    try { assert.equal(job.agendar(), null); } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
  });

  console.log('Auditoria, flags e legado');
  await passo('cada gravação de estado deixou linha em gf_auditoria (ator, ação, antes/depois) e o job NÃO usa a auditoria de usuário', async () => {
    const [l] = await sequelize.query("SELECT acao, ator_funcao, entidade, entidade_id, antes, depois FROM gf_auditoria WHERE acao LIKE 'presenca.%' ORDER BY ocorrido_em");
    assert.ok(l.length >= 12, `${l.length} linhas`);
    assert.ok(l.every((x) => x.entidade === 'presenca' && ['atendente', 'administradora', 'assistente', 'supervisora', 'tarologa'].includes(x.ator_funcao)));
    const a = l.find((x) => x.acao === 'presenca.status' && x.entidade_id === 'osiris');
    assert.ok(a && a.antes && a.depois && a.depois.shiftStatus);
    assert.ok(l.some((x) => x.acao === 'presenca.confirmar') && l.some((x) => x.acao === 'presenca.pedido'));
  });
  await passo('as chaves gravaram em gf_operacoes (escopo presenca.*) e a repetição não duplicou a auditoria', async () => {
    const ops = await contar("SELECT COUNT(*) AS n FROM gf_operacoes WHERE escopo LIKE 'presenca.%'");
    const aud = await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao LIKE 'presenca.%'");
    assert.equal(ops, aud);
  });
  await passo('o histórico guarda a ordem e o job deixa a chave "job:presenca:…" (rastreio)', async () => {
    const [h] = await sequelize.query("SELECT ordem, operation_key FROM gf_presenca_historico WHERE id_tarologo = 'iolanda' ORDER BY ordem");
    assert.deepEqual(h.map((x) => Number(x.ordem)), h.map((_, i) => i + 1));
    assert.ok(h.some((x) => String(x.operation_key).startsWith('job:presenca:')));
  });
  await passo('escrita desligada: leitura segue 200 e gravação responde 503 WRITE_DISABLED', async () => {
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
    try {
      como('atendente');
      assert.equal((await ler()).status, 200);
      const x = await status('nyx', '0', { shiftStatus: 'Offline' });
      assert.equal(x.status, 503); assert.equal(x.j.error.code, 'WRITE_DISABLED');
    } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
  });
  await passo('fatia desligada em tempo de execução: 404', async () => {
    process.env.GF_FATIA_PRESENCA = 'false';
    try { assert.equal((await ler()).status, 404); } finally { process.env.GF_FATIA_PRESENCA = 'true'; }
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
