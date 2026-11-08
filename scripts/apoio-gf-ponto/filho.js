'use strict';

/**
 * FILHO de scripts/verificar-gf-ponto.js: roda contra o Postgres DESCARTÁVEL (fdb_pon_*) já migrado, com DB_* só no ambiente deste processo.
 * Prova pelo HTTP do gate (sessão de mentira, usuários da A criados no banco): flag desligada, sessão e funções, ponto (entrada, batimento,
 * pausa, volta, saída, turno trocado, entradas simultâneas), escala própria e da equipe (revisão, 409), equipe no dia, turnos, recepção do
 * diário com token, escrita desligada e auditoria. O front lê o erro como TEXTO: toda recusa tem de vir em `{ error: <frase> }`.
 */

const path = require('path');
const assert = require('assert');
const { randomUUID } = require('crypto');
const express = require('express');
const { raiz, passo, resumo } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_PONTO: 'true' });
delete process.env.STAFF_ACTIVITY_INGEST_TOKEN;
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { User, StaffProfile } = require(r('src/models'));
  const criar = async (nome, role) => { const id = randomUUID(); await User.create({ id, email: `${nome.toLowerCase().replace(/\W+/g, '.')}.${id.slice(0, 6)}@teste.local`, role, is_active: true }); await StaffProfile.create({ user_id: id, display_name: nome }); return id; };
  const uAt1 = await criar('Atendente Um', 'ATENDENTE'); const uAt2 = await criar('Atendente Dois', 'ATENDENTE'); const uAdm = await criar('Gestora Ponto', 'GESTORA');
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  let sessao = { userId: uAt1, role: 'atendente', displayName: 'Atendente Um' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => (sessao ? { status: 'identity', identity: sessao, sessionId: 'sessao-pon' } : { status: 'absent' }) }, verificarLegado: async () => true }));
  app.use((req, res) => res.status(404).json({ doFront: true })); // o que responderia a rota do próprio front
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const host = `127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, recurso, corpo, { extra = '', cab = {}, semOrigem = false, cru } = {}) => {
    const headers = { ...(corpo !== undefined || cru !== undefined ? { 'content-type': 'application/json' } : {}), ...(metodo !== 'GET' && !semOrigem ? { origin: `http://${host}` } : {}), ...cab };
    const resp = await fetch(`http://${host}/api/staff-clock?resource=${recurso}${extra}`, { method: metodo, headers, body: cru !== undefined ? cru : corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, h: resp.headers };
  };
  const como = (quem) => { sessao = quem === 'adm' ? { userId: uAdm, role: 'administradora', displayName: 'Gestora Ponto' } : quem === 'at2' ? { userId: uAt2, role: 'atendente', displayName: 'Atendente Dois' } : quem === 'sem' ? null : quem === 'tarologa' ? { userId: uAt1, role: 'tarologa', displayName: 'Osíris', tarotId: 'osiris' } : { userId: uAt1, role: 'atendente', displayName: 'Atendente Um' }; };
  const texto = (x, status, frase) => { assert.equal(x.status, status, JSON.stringify(x.j)); assert.equal(typeof x.j.error, 'string', 'erro tem de ser texto'); if (frase) assert.match(x.j.error, frase); };
  const um = async (sql, rep) => (await sequelize.query(sql, { replacements: rep }))[0];
  const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const dia = (n) => new Date(Date.parse(`${hoje}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

  console.log('Esquema e flag');
  await passo('3 tabelas existem e a migração roda de novo sem erro', async () => {
    const t = await um("SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('gf_ponto_turnos','gf_ponto_escalas','gf_ponto_eventos')");
    assert.equal(t.length, 3);
    await require(r('migrations/20261205000000-gestao-fadas-ponto')).up({ sequelize });
  });
  await passo('fatia desligada: passa adiante (responde a rota do front), sem tocar sessão', async () => {
    process.env.GF_FATIA_PONTO = 'false'; como('sem');
    const x = await chamar('GET', 'session'); assert.equal(x.status, 404); assert.equal(x.j.doFront, true);
    process.env.GF_FATIA_PONTO = 'true';
  });
  await passo('availability é público; sem sessão os demais pedem entrada (401 em texto); método fora do contrato é 405', async () => {
    como('sem');
    const a = await chamar('GET', 'availability'); assert.equal(a.status, 200); assert.deepEqual(a.j, { enabled: true });
    assert.equal(a.h.get('cache-control'), 'no-store');
    texto(await chamar('GET', 'session'), 401, /Entre/);
    texto(await chamar('GET', 'current'), 401);
    const d = await chamar('DELETE', 'current'); texto(d, 405, /Método não permitido/); assert.match(d.h.get('allow'), /GET/);
  });
  await passo('quem não tem função no ponto (taróloga) recebe 403 em texto', async () => { como('tarologa'); texto(await chamar('GET', 'session'), 403, /conta autenticada e autorizada/); });

  console.log('Sessão');
  await passo('atendente: sessão do servidor com o próprio ID; administradora recebe a lista das atendentes ativas', async () => {
    como('at'); const a = await chamar('GET', 'session'); assert.equal(a.status, 200);
    assert.deepEqual(a.j, { mode: 'server', accountId: uAt1, accountName: 'Atendente Um', role: 'atendente' });
    como('adm'); const b = await chamar('GET', 'session'); assert.equal(b.j.role, 'administradora');
    assert.deepEqual(b.j.staff.map((s) => s.id).sort(), [uAt1, uAt2].sort()); assert.ok(b.j.staff.every((s) => s.name));
  });

  console.log('Ponto (current)');
  let turno;
  await passo('GET inicial vazio; enter abre o turno com o relógio do servidor; repetir enter não duplica', async () => {
    como('at'); const v = await chamar('GET', 'current'); assert.equal(v.status, 200); assert.equal(v.j.shift, null);
    const e = await chamar('POST', 'current', { command: 'enter' }); assert.equal(e.status, 200, JSON.stringify(e.j));
    turno = e.j.shift; assert.equal(turno.accountId, uAt1); assert.equal(turno.accountName, 'Atendente Um'); assert.equal(turno.events[0].kind, 'start');
    assert.ok(Math.abs(Date.now() - Date.parse(turno.startedAt)) < 60_000, 'carimbo do servidor');
    const de = await chamar('POST', 'current', { command: 'enter' }); assert.equal(de.j.shift.id, turno.id);
    assert.equal(Number((await um('SELECT COUNT(*) AS n FROM gf_ponto_turnos WHERE id_conta = :c', { c: uAt1 }))[0].n), 1);
  });
  await passo('entradas simultâneas (5 pedidos juntos) continuam em UM turno', async () => {
    como('at2'); const todos = await Promise.all(Array.from({ length: 5 }, () => chamar('POST', 'current', { command: 'enter' })));
    assert.ok(todos.every((x) => x.status === 200)); assert.equal(new Set(todos.map((x) => x.j.shift.id)).size, 1);
    assert.equal(Number((await um('SELECT COUNT(*) AS n FROM gf_ponto_turnos WHERE id_conta = :c', { c: uAt2 }))[0].n), 1);
    como('at');
  });
  await passo('pausa, volta e saída exigem o turno visível; turno errado é 409 em texto; encerrado aceita novo início', async () => {
    texto(await chamar('POST', 'current', { command: 'pause', shiftId: 'outro-turno' }), 409, /O turno mudou/);
    texto(await chamar('POST', 'current', { command: 'pause' }), 409, /O turno mudou/);
    const p = await chamar('POST', 'current', { command: 'pause', shiftId: turno.id }); assert.equal(p.status, 200, JSON.stringify(p.j)); assert.equal(p.j.shift.events.at(-1).kind, 'pause');
    const v = await chamar('POST', 'current', { command: 'resume', shiftId: turno.id }); assert.equal(v.status, 200, JSON.stringify(v.j)); assert.equal(v.j.shift.events.at(-1).kind, 'resume');
    const f = await chamar('POST', 'current', { command: 'end', shiftId: turno.id }); assert.equal(f.status, 200, JSON.stringify(f.j)); assert.ok(f.j.shift.endedAt);
    const l = await chamar('GET', 'current'); assert.equal(l.j.shift.endedAt, f.j.shift.endedAt);
    const n = await chamar('POST', 'current', { command: 'start', shiftId: turno.id }); assert.equal(n.status, 200, JSON.stringify(n.j)); assert.notEqual(n.j.shift.id, turno.id); turno = n.j.shift;
  });
  await passo('validações: comando inválido, campo extra, JSON ruim, tipo de conteúdo, origem de outro site, corpo grande', async () => {
    texto(await chamar('POST', 'current', { command: 'sair' }), 400, /Comando ou identificação/);
    texto(await chamar('POST', 'current', { command: 'enter', conta: 'x' }), 400, /Comando ou identificação/);
    texto(await chamar('POST', 'current', undefined, { cru: '{ruim' }), 400, /JSON inválido/);
    texto(await chamar('POST', 'current', undefined, { cab: { 'content-type': 'text/plain' }, cru: '{}' }), 415, /Envie JSON/);
    texto(await chamar('POST', 'current', { command: 'enter' }, { semOrigem: true }), 403, /Origem não autorizada/);
    texto(await chamar('POST', 'current', { command: 'enter' }, { cab: { origin: 'http://outro-site.example' } }), 403, /Origem não autorizada/);
    texto(await chamar('POST', 'current', { command: 'enter', lixo: 'x'.repeat(300_000) }), 413, /extenso/);
  });
  await passo('administradora não bate ponto (403); atendente não consulta a equipe (403)', async () => {
    como('adm'); texto(await chamar('GET', 'current'), 403, /própria atendente/); texto(await chamar('POST', 'current', { command: 'enter' }), 403);
    como('at'); texto(await chamar('GET', 'team-day', undefined, { extra: `&date=${hoje}` }), 403, /acesso administrativo/); texto(await chamar('GET', 'shifts'), 403);
  });

  console.log('Escala própria e da equipe');
  let rev = 0;
  await passo('minha escala: lê vazia com a data de hoje; grava exceção de uma data futura; revisão antiga é 409', async () => {
    como('at'); const v = await chamar('GET', 'my-schedule'); assert.equal(v.status, 200); assert.equal(v.j.roster, null); assert.equal(v.j.revision, 0); assert.equal(v.j.today, hoje);
    const g = await chamar('PUT', 'my-schedule', { date: dia(2), periods: [{ start: '09:00', end: '15:00' }], revision: 0 }); assert.equal(g.status, 200, JSON.stringify(g.j));
    assert.equal(g.j.revision, 1); assert.deepEqual(g.j.roster.exceptions[dia(2)], [{ start: '09:00', end: '15:00' }]); rev = g.j.revision;
    texto(await chamar('PUT', 'my-schedule', { date: dia(3), periods: [], revision: 0 }), 409, /escala mudou/);
    const folga = await chamar('PUT', 'my-schedule', { date: dia(3), periods: [], revision: rev }); assert.deepEqual(folga.j.roster.exceptions[dia(3)], []); rev = folga.j.revision;
    const volta = await chamar('PUT', 'my-schedule', { date: dia(3), periods: null, revision: rev }); assert.equal(volta.j.roster.exceptions[dia(3)], undefined); rev = volta.j.revision;
  });
  await passo('minha escala recusa: data passada, períodos ruins, campos extras, accountId, administradora; frases do front', async () => {
    texto(await chamar('PUT', 'my-schedule', { date: dia(-1), periods: [], revision: rev }), 400, /hoje ou de uma data futura/);
    texto(await chamar('PUT', 'my-schedule', { date: dia(4), periods: [{ start: '09:00', end: '09:00' }], revision: rev }), 400, /Confira o início e o fim/);
    texto(await chamar('PUT', 'my-schedule', { date: dia(4), periods: [], revision: rev, lixo: 1 }), 400);
    texto(await chamar('GET', 'my-schedule', undefined, { extra: '&accountId=x' }), 400, /identidade da sessão/);
    como('adm'); texto(await chamar('GET', 'my-schedule'), 403, /Somente a atendente/); como('at');
  });
  await passo('administradora lê e grava a escala de uma atendente (revisão, 409, 400 e 404); quem grava fica na auditoria', async () => {
    como('adm'); const v = await chamar('GET', 'schedule', undefined, { extra: `&accountId=${uAt1}` }); assert.equal(v.j.revision, rev);
    const roster = { weekly: [{ from: dia(0), days: { 1: [{ start: '10:00', end: '18:00' }], 2: [{ start: '22:00', end: '03:00' }] } }], exceptions: {} };
    texto(await chamar('PUT', 'schedule', { roster, revision: rev - 1 }, { extra: `&accountId=${uAt1}` }), 409, /alterada em outra sessão/);
    const g = await chamar('PUT', 'schedule', { roster, revision: rev }, { extra: `&accountId=${uAt1}` }); assert.equal(g.status, 200, JSON.stringify(g.j)); assert.equal(g.j.revision, rev + 1);
    texto(await chamar('PUT', 'schedule', { roster: { weekly: [], exceptions: { '2026-02-31': [] } }, revision: g.j.revision }, { extra: `&accountId=${uAt1}` }), 400, /Revise os horários/);
    texto(await chamar('GET', 'schedule', undefined, { extra: '&accountId=inexistente' }), 404, /Atendente não encontrada/);
    const [l] = await um("SELECT atualizado_por FROM gf_ponto_escalas WHERE id_conta = :c", { c: uAt1 }); assert.equal(l.atualizado_por, uAdm);
    const auds = await um("SELECT ator_conta_id, acao FROM gf_auditoria WHERE entidade = 'ponto_escala' ORDER BY ocorrido_em");
    assert.ok(auds.length >= 4 && auds.some((a) => a.acao === 'ponto.escala.equipe' && a.ator_conta_id === uAdm) && auds.some((a) => a.acao === 'ponto.escala.propria' && a.ator_conta_id === uAt1), JSON.stringify(auds));
  });
  await passo('equipe no dia: cada atendente com escala e turnos; turnos do período; período inválido é 400', async () => {
    como('adm'); const d = await chamar('GET', 'team-day', undefined, { extra: `&date=${hoje}` }); assert.equal(d.status, 200, JSON.stringify(d.j));
    const a1 = d.j.team.find((t) => t.accountId === uAt1); assert.ok(a1.roster && a1.shifts.length === 2); assert.equal(d.j.team.find((t) => t.accountId === uAt2).shifts.length, 1);
    texto(await chamar('GET', 'team-day', undefined, { extra: '&date=2026-02-31' }), 400, /data válida/);
    const s = await chamar('GET', 'shifts', undefined, { extra: `&accountId=${uAt1}&from=${dia(-1)}&to=${dia(1)}` }); assert.equal(s.j.shifts.length, 2);
    texto(await chamar('GET', 'shifts', undefined, { extra: `&accountId=${uAt1}&from=${dia(1)}&to=${dia(-1)}` }), 400, /até um ano/);
    texto(await chamar('GET', 'shifts', undefined, { extra: `&accountId=${uAt1}&from=2024-01-01&to=2026-01-01` }), 400, /até um ano/);
  });

  console.log('Diário de ações confirmadas (ingest e activity)');
  const TOKEN = 'token-de-teste-local-com-mais-de-32-caracteres';
  const ev = (extra = {}) => ({ event: { id: 'pagamento:pag-1:criacao-01', category: 'pagamento', recordId: 'pag-1', actorId: uAt1, actorKind: 'person', at: new Date(Date.now() - 60_000).toISOString(), action: 'Lançou pagamento', actionCode: 'payment.created', detail: 'ok', origin: 'captured', ...extra } });
  const ing = (corpo, cab = {}) => chamar('POST', 'ingest', corpo, { semOrigem: true, cab });
  const evento1 = ev();
  await passo('sem token configurado a recepção é 503; com token: credencial errada, cookie ou origem são 403', async () => {
    texto(await ing(evento1, { authorization: `Bearer ${TOKEN}` }), 503, /não configurada/);
    process.env.STAFF_ACTIVITY_INGEST_TOKEN = TOKEN; como('sem');
    texto(await ing(evento1), 403, /Credencial/); texto(await ing(evento1, { authorization: 'Bearer errado' }), 403, /inválida/);
    texto(await ing(evento1, { authorization: `Bearer ${TOKEN}`, cookie: 'a=b' }), 403); texto(await ing(evento1, { authorization: `Bearer ${TOKEN}`, origin: 'http://x' }), 403);
  });
  await passo('evento novo 201, repetido 200, outro conteúdo com o mesmo ID 409; sem autoria ou de página recebem 400', async () => {
    const h = { authorization: `Bearer ${TOKEN}` };
    const a = await ing(evento1, h); assert.equal(a.status, 201, JSON.stringify(a.j)); assert.equal(a.j.id, evento1.event.id); assert.equal(a.j.created, true); assert.equal(a.j.presence.activityCount, 1, 'v711: o recibo traz a presença detectada'); assert.deepEqual(Object.keys(a.j).sort(), ['created', 'id', 'presence']);
    const b = await ing(evento1, h); assert.equal(b.status, 200); assert.equal(b.j.created, false);
    texto(await ing(ev({ detail: 'mudou' }), h), 409, /evento diferente/);
    texto(await ing(ev({ id: 'x2', actorId: uAdm }), h), 400, /confirmados/); texto(await ing(ev({ id: 'x3', actorKind: 'system' }), h), 400);
    texto(await ing(ev({ id: 'x4', actionCode: 'page.visited' }), h), 400); texto(await ing(ev({ id: 'x5', at: new Date(Date.now() + 3_600_000).toISOString() }), h), 400);
    texto(await ing(ev({ id: 'x6', at: '2026-11-06' }), h), 400); texto(await ing(ev({ id: 'x7', category: 'tela' }), h), 400);
    const [s] = await um("SELECT COUNT(*) AS n FROM gf_ponto_eventos"); assert.equal(Number(s.n), 1);
  });
  await passo('a administradora lê o diário da atendente no período; sem token configurado o que já entrou continua visível', async () => {
    como('adm'); const de = new Date(Date.now() - 3_600_000).toISOString(); const ate = new Date().toISOString();
    const a = await chamar('GET', 'activity', undefined, { extra: `&accountId=${uAt1}&from=${de}&to=${ate}` }); assert.equal(a.status, 200, JSON.stringify(a.j));
    assert.equal(a.j.coverage, 'confirmed-events-received'); assert.equal(a.j.events.length, 1); assert.equal(a.j.events[0].actorId, uAt1);
    const vazio = await chamar('GET', 'activity', undefined, { extra: `&accountId=${uAt2}&from=${de}&to=${ate}` }); assert.deepEqual(vazio.j.events, []);
    delete process.env.STAFF_ACTIVITY_INGEST_TOKEN;
    assert.equal((await chamar('GET', 'activity', undefined, { extra: `&accountId=${uAt1}&from=${de}&to=${ate}` })).j.events.length, 1);
    texto(await chamar('GET', 'activity', undefined, { extra: `&accountId=${uAt1}&from=2026-01-01&to=${ate}` }), 400, /período válido/);
  });
  await passo('o diário só acrescenta: UPDATE e DELETE são barrados pelo banco', async () => {
    await assert.rejects(() => um("UPDATE gf_ponto_eventos SET id_conta = 'x'"), /so acrescenta/);
    await assert.rejects(() => um('DELETE FROM gf_ponto_eventos'), /so acrescenta/);
  });

  console.log('Escrita desligada');
  await passo('com a gravação desligada a leitura segue e a escrita é 503 em texto', async () => {
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false'; como('at');
    assert.equal((await chamar('GET', 'current')).status, 200);
    texto(await chamar('POST', 'current', { command: 'heartbeat' }), 503, /banco de ponto está indisponível/);
    texto(await chamar('PUT', 'my-schedule', { date: dia(5), periods: [], revision: 1 }), 503);
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true';
  });
  await passo('nada do ponto sai das tabelas gf_ponto_* (sem MySQL legado, sem DELETE nos dados)', async () => {
    const t = await um("SELECT COUNT(*) AS n FROM gf_ponto_turnos"); assert.ok(Number(t[0].n) >= 3);
  });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPonto (banco): ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
