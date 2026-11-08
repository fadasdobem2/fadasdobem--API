'use strict';

/**
 * FILHO de scripts/verificar-gf-v711.js: roda contra o Postgres DESCARTÁVEL (fdb_v711_*) já migrado. Prova, pelo HTTP do gate e com banco real:
 *   - formas de atendimento do dia (`/professional-services`): gravação, revisão, corrida, dia de HOJE no servidor, CHECK da tabela e o `serviceModesToday` no contexto da Lilly;
 *   - presença por atividade (`/staff-clock`): recibo do `ingest` com `presence`, `resource=presence` (só a própria), `team-day` com `activity`, idempotência e janela do dia.
 */

const path = require('path');
const assert = require('assert');
const { randomUUID } = require('crypto');
const express = require('express');
const { raiz, passo, resumo } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_FORMAS: 'true', GF_FATIA_PONTO: 'true', FADAS_ORIGIN: 'https://fadas.example.org', STAFF_ACTIVITY_INGEST_TOKEN: 'x'.repeat(40) });
const r = (p) => path.join(raiz, p);
const ORIGEM = process.env.FADAS_ORIGIN;

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { User, StaffProfile } = require(r('src/models'));
  const criar = async (nome, role) => { const id = randomUUID(); await User.create({ id, email: `${nome.toLowerCase().replace(/\W+/g, '.')}.${id.slice(0, 6)}@teste.local`, role, is_active: true }); await StaffProfile.create({ user_id: id, display_name: nome }); return id; };
  const uAdm = await criar('Gestora V711', 'GESTORA'); const uAt = await criar('Atendente V711', 'ATENDENTE'); const uAt2 = await criar('Atendente Dois', 'ATENDENTE');
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  let sessao = { userId: uAdm, role: 'administradora', displayName: 'Gestora V711' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => (sessao ? { status: 'identity', identity: sessao, sessionId: 's-v711' } : { status: 'absent' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1'); await new Promise((f) => srv.once('listening', f));
  const host = `127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, rota, corpo, cab = {}) => {
    const resp = await fetch(`http://${host}/api/${rota}`, { method: metodo, headers: { ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(metodo !== 'GET' && !cab.semOrigem && !cab.authorization ? { origin: rota.startsWith('staff-clock') ? `http://${host}` : ORIGEM } : {}), ...(cab.authorization ? { authorization: cab.authorization } : {}) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ } return { status: resp.status, j, t };
  };
  const um = async (sql, rep) => (await sequelize.query(sql, { replacements: rep }))[0];
  const { operationalDateAt } = require(r('src/gestao-fadas/_comum/dominio/operacao-calendario'));
  const hoje = operationalDateAt(new Date());

  console.log('Formas de atendimento (banco real)');
  await passo('tabela existe; fatia desligada passa adiante; sem sessão é 401 em texto', async () => {
    assert.equal(Number((await um("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_name = 'gf_formas_atendimento_dia'"))[0].n), 1);
    process.env.GF_FATIA_FORMAS = 'false'; const off = await chamar('GET', 'professional-services'); assert.notEqual(off.status, 200); process.env.GF_FATIA_FORMAS = 'true';
    sessao = null; const x = await chamar('GET', 'professional-services'); assert.equal(x.status, 401); assert.equal(typeof x.j.error, 'string'); sessao = { userId: uAdm, role: 'administradora', displayName: 'Gestora V711' };
  });
  await passo('a administradora grava as formas de HOJE de uma profissional; a leitura devolve a linha com revisão 1 e o responsável; o dia é o do servidor', async () => {
    const g0 = await chamar('GET', 'professional-services?tarotId=t-900'); assert.equal(g0.status, 200); assert.equal(g0.j.date, hoje); assert.equal(g0.j.row, null);
    const p = await chamar('PUT', 'professional-services?tarotId=t-900', { date: hoje, modes: ['texto', 'pabx'], revision: 0 }); assert.equal(p.status, 200, p.t);
    assert.deepEqual(p.j.row.modes, ['pabx', 'texto']); assert.equal(p.j.row.revision, 1); assert.equal(p.j.row.updatedBy, uAdm);
    const l = (await um("SELECT formas::text AS f, revisao, to_char(data_operacional,'YYYY-MM-DD') AS d FROM gf_formas_atendimento_dia WHERE tarologo_id = 't-900'"))[0]; assert.equal(l.d, hoje); assert.equal(Number(l.revisao), 1);
    const lista = await chamar('GET', 'professional-services'); assert.ok(lista.j.rows.some((x) => x.tarotId === 't-900' && x.modes.join() === 'pabx,texto'));
  });
  await passo('revisão velha e data de outro dia são 409; corrida com a mesma revisão grava uma só; conjunto vazio é permitido', async () => {
    assert.equal((await chamar('PUT', 'professional-services?tarotId=t-900', { date: hoje, modes: ['audio'], revision: 0 })).status, 409);
    assert.equal((await chamar('PUT', 'professional-services?tarotId=t-900', { date: '2020-01-01', modes: ['audio'], revision: 1 })).status, 409);
    const dois = await Promise.all(['audio', 'texto'].map((m) => chamar('PUT', 'professional-services?tarotId=t-900', { date: hoje, modes: [m], revision: 1 })));
    assert.deepEqual(dois.map((x) => x.status).sort(), [200, 409]);
    const v = await chamar('PUT', 'professional-services?tarotId=t-900', { date: hoje, modes: [], revision: 2 }); assert.equal(v.status, 200); assert.deepEqual(v.j.row.modes, []);
  });
  await passo('profissional só mexe no próprio dia; atendente lê mas não grava; origem de outro site é 403; forma desconhecida é 400', async () => {
    sessao = { userId: uAt, role: 'tarologa', displayName: 'T', tarotId: 't-901' };
    assert.equal((await chamar('PUT', 'professional-services?tarotId=t-900', { date: hoje, modes: ['audio'], revision: 3 })).status, 403);
    assert.equal((await chamar('PUT', 'professional-services?tarotId=t-901', { date: hoje, modes: ['audio'], revision: 0 })).status, 200);
    assert.equal((await chamar('PUT', 'professional-services', { date: hoje, modes: ['pabx'], revision: 1 })).status, 200);
    sessao = { userId: uAt, role: 'atendente', displayName: 'A' }; assert.equal((await chamar('GET', 'professional-services')).status, 200); assert.equal((await chamar('PUT', 'professional-services?tarotId=t-901', { date: hoje, modes: ['audio'], revision: 2 })).status, 403);
    sessao = { userId: uAdm, role: 'administradora', displayName: 'G' };
    const f = await fetch(`http://${host}/api/professional-services?tarotId=t-902`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ date: hoje, modes: ['audio'], revision: 0 }) }); assert.equal(f.status, 403);
    assert.equal((await chamar('PUT', 'professional-services?tarotId=t-902', { date: hoje, modes: ['video'], revision: 0 })).status, 400);
  });
  await passo('CHECK da tabela recusa forma fora de PABX/Áudio/Texto, fora de ordem ou repetida, e revisão zero', async () => {
    const tenta = async (formas, rev = 1) => { try { await sequelize.query("INSERT INTO gf_formas_atendimento_dia (tarologo_id, data_operacional, formas, revisao, atualizado_em, atualizado_por) VALUES ('c', :d, CAST(:f AS jsonb), :r, now(), 'x')", { replacements: { d: hoje, f: JSON.stringify(formas), r: rev } }); await sequelize.query("DELETE FROM gf_formas_atendimento_dia WHERE tarologo_id = 'c'").catch(() => {}); return 'gravou'; } catch (e) { return e.parent ? e.parent.code : e.name; } };
    for (const f of [['video'], ['texto', 'pabx'], ['audio', 'audio'], 'pabx', ['pabx', 'audio', 'texto', 'texto']]) assert.equal(await tenta(f), '23514', JSON.stringify(f));
    assert.equal(await tenta(['pabx'], 0), '23514'); assert.equal(await tenta(['pabx', 'texto']), 'gravou'); assert.equal(await tenta([]), 'gravou');
  });
  await passo('o contexto da Lilly traz serviceModesToday (data, meios, quem e quando) das profissionais com linha do dia; sem linha, nada é inventado', async () => {
    const { montarTarologos } = require(r('src/gestao-fadas/features/lilly/contexto/montador.tarologos'));
    const { formasDoDia } = require(r('src/gestao-fadas/features/lilly/contexto/fontes.novo'));
    const formas = await formasDoDia(hoje); const linha = formas.find((x) => x.tarologo_id === 't-901'); assert.ok(linha);
    const catalogo = [{ id: 't-901', name: 'Ana', registrationActive: true, directory: { serviceModes: ['texto'], umblerContact: { contactId: 'u1' } } }, { id: 't-777', name: 'Bia', registrationActive: true }];
    const t = montarTarologos({ catalogo, presencas: [], escalas: [], citados: new Set(), hoje, amanha: hoje, formas });
    const ana = t.find((x) => x.id === 't-901'); const bia = t.find((x) => x.id === 't-777');
    assert.deepEqual(ana.serviceModesToday.modes, ['pabx']); assert.equal(ana.serviceModesToday.date, hoje); assert.equal(ana.serviceModesToday.updatedBy, uAt); assert.ok(Date.parse(ana.serviceModesToday.updatedAt));
    assert.deepEqual(ana.serviceModes, ['texto']); assert.deepEqual(ana.umblerContact, { contactId: 'u1' });
    assert.equal(bia.serviceModesToday, undefined); assert.equal(bia.serviceModes, undefined); assert.equal(bia.umblerContact, undefined);
  });

  console.log('Presença por atividade (banco real)');
  const token = `Bearer ${process.env.STAFF_ACTIVITY_INGEST_TOKEN}`;
  const agora = Date.now(); const iso = (ms) => new Date(ms).toISOString();
  const evento = (id, conta, em, extra = {}) => ({ event: { id, category: 'consulta', action: 'Consulta iniciada', actionCode: 'consulta.iniciar', actorId: conta, actorKind: 'person', at: iso(em), recordId: 'c1', detail: 'ok', origin: 'captured', ...extra } });
  await passo('ingest devolve a presença já com o evento (primeira, última e quantas); repetir o mesmo ID não aumenta; ID com outro conteúdo é 409', async () => {
    sessao = null;
    const a = await chamar('POST', 'staff-clock?resource=ingest', evento('ev-1', uAt, agora - 600_000), { authorization: token }); assert.equal(a.status, 201, a.t); assert.equal(a.j.id, 'ev-1'); assert.equal(a.j.presence.activityCount, 1); assert.equal(a.j.presence.firstActivityAt, iso(agora - 600_000)); assert.equal(a.j.presence.operationalDate, hoje);
    const b = await chamar('POST', 'staff-clock?resource=ingest', evento('ev-2', uAt, agora - 120_000), { authorization: token }); assert.equal(b.j.presence.activityCount, 2); assert.equal(b.j.presence.lastActivityAt, iso(agora - 120_000)); assert.equal(b.j.presence.firstActivityAt, iso(agora - 600_000));
    const c = await chamar('POST', 'staff-clock?resource=ingest', evento('ev-2', uAt, agora - 120_000), { authorization: token }); assert.equal(c.status, 200); assert.equal(c.j.created, false); assert.equal(c.j.presence.activityCount, 2);
    assert.equal((await chamar('POST', 'staff-clock?resource=ingest', evento('ev-2', uAt, agora - 120_000, { detail: 'outro' }), { authorization: token })).status, 409);
    const d = await chamar('POST', 'staff-clock?resource=ingest', evento('ev-3', uAt2, agora - 60_000), { authorization: token }); assert.equal(d.j.presence.activityCount, 1, 'a presença é por pessoa');
  });
  await passo('evento do futuro e de outro dia operacional não entram na presença de hoje', async () => {
    await chamar('POST', 'staff-clock?resource=ingest', evento('ev-ontem', uAt, agora - 30 * 3600_000), { authorization: token });
    const e = await chamar('POST', 'staff-clock?resource=ingest', evento('ev-fut', uAt, agora + 200_000), { authorization: token }); assert.equal(e.status, 201); assert.equal(e.j.presence.activityCount, 2, 'o futuro tolerado fica fora até chegar a hora');
    sessao = { userId: uAt, role: 'atendente', displayName: 'Atendente V711' };
    const p = await chamar('GET', 'staff-clock?resource=presence'); assert.equal(p.status, 200); assert.equal(p.j.presence.activityCount, 2);
  });
  await passo('resource=presence é só da própria atendente: administradora 403, outra conta 400, método errado 400, sem atividade devolve null', async () => {
    sessao = { userId: uAdm, role: 'administradora', displayName: 'G' }; const a = await chamar('GET', 'staff-clock?resource=presence'); assert.equal(a.status, 403); assert.equal(typeof a.j.error, 'string');
    sessao = { userId: uAt, role: 'atendente', displayName: 'A' }; assert.equal((await chamar('GET', `staff-clock?resource=presence&accountId=${uAt2}`)).status, 400);
    assert.equal((await chamar('POST', 'staff-clock?resource=presence', {})).status, 400);
    const nova = await criar('Sem Atividade', 'ATENDENTE'); sessao = { userId: nova, role: 'atendente', displayName: 'N' }; const n = await chamar('GET', 'staff-clock?resource=presence'); assert.equal(n.status, 200); assert.equal(n.j.presence, null);
  });
  await passo('team-day: cada atendente traz `activity` (inclusive null para quem não tem), sem depender do ponto declarado', async () => {
    sessao = { userId: uAdm, role: 'administradora', displayName: 'G' };
    const t = await chamar('GET', `staff-clock?resource=team-day&date=${hoje}`); assert.equal(t.status, 200, t.t);
    const por = Object.fromEntries(t.j.team.map((x) => [x.accountId, x])); assert.equal(por[uAt].activity.activityCount, 2); assert.equal(por[uAt2].activity.activityCount, 1);
    assert.ok(t.j.team.every((x) => Object.prototype.hasOwnProperty.call(x, 'activity'))); assert.ok(t.j.team.some((x) => x.activity === null));
    assert.deepEqual(por[uAt].shifts, [], 'a atividade não inventa turno declarado');
  });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nv711 (banco): ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
