'use strict';

/**
 * FILHO de scripts/verificar-gf-horarios.js: roda contra o Postgres DESCARTÁVEL (fdb_hor_*) já migrado, com DB_* só no ambiente
 * deste processo. Prova pelo HTTP do gate (sessão de mentira, usuários reais da A no banco): leitura vazia, gravação com
 * idempotência, 409 de versão e de chave, corrida entre duas gravações, trechos preservados, remoção, escala semanal, perfis,
 * auditoria na mesma transação, escrita desligada e que nada de estrutura nova foi pedido ao MySQL legado.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, conferir, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_HORARIOS: 'true' });
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const uStaff = await criarUsuario('Atendente Horários');
  const uTar = await criarUsuario('Osíris Horários');
  let sessao = { userId: uStaff, role: 'atendente', displayName: 'Atendente Horários' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-hor' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 200), h: resp.headers };
  };
  const como = (perfil, extra = {}) => { sessao = { userId: perfil === 'tarologa' ? uTar : uStaff, role: perfil, displayName: 'Teste', ...extra }; };
  const n = () => { n.i = (n.i || 0) + 1; return `op-${Date.now()}-${n.i}`; };
  const ov = (ini, fim, extra = {}) => ({ todayHours: '9h às 15h', periods: [{ start: '09:00', end: '15:00' }], note: 'Recado', updatedAt: '2026-11-01T10:00:00', absenceType: 'Nenhuma', startDate: ini, endDate: fim, ...extra });
  const colocar = (tarot, override, revisao, extra = {}) => chamar('PUT', `/schedules/${tarot}/overrides`, { operationKey: n(), expectedRevision: revisao, override, ...extra });
  const ler = async (q = '') => (await chamar('GET', `/schedules${q}`));
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);

  console.log('Esquema');
  await passo('3 tabelas da fatia existem e a migração roda de novo sem erro', async () => {
    const [t] = await sequelize.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('gf_escalas_semanais','gf_horarios_excecoes','gf_horarios_periodos')");
    assert.equal(t.length, 3);
    await require(r('migrations/20261102000000-gestao-fadas-horarios')).up({ sequelize });
  });

  console.log('Leitura');
  como('atendente');
  const vazio = await ler();
  await passo('GET vazio: 200, DTO puro, no-store, revisão vazia', async () => {
    assert.equal(vazio.status, 200, vazio.t);
    assert.ok(!('sucesso' in vazio.j) && vazio.j.emptyRevision && Array.isArray(vazio.j.profiles) && Array.isArray(vazio.j.holidays));
    assert.deepEqual(vazio.j.overrides, {});
    assert.equal(vazio.h.get('cache-control'), 'no-store');
    assert.match(vazio.j.today, /^\d{4}-\d{2}-\d{2}$/);
  });
  const rev0 = vazio.j.emptyRevision;

  console.log('Gravação');
  const k1 = n();
  const corpo1 = { operationKey: k1, expectedRevision: rev0, override: ov('2026-11-05', '2026-11-05', { commandId: 'cmd-1', rosterResponse: { actor: 'Equipe', at: '2026-11-01T10:00:00.000Z' } }) };
  const g1 = await chamar('PUT', '/schedules/osiris/overrides', corpo1);
  await passo('PUT exceção por dia (atendente): 200, chave osiris@data, campos opcionais preservados, revisão nova', async () => {
    assert.equal(g1.status, 200, g1.t);
    const o = g1.j.overrides['osiris@2026-11-05'];
    assert.equal(o.todayHours, '9h às 15h'); assert.deepEqual(o.periods, [{ start: '09:00', end: '15:00' }]);
    assert.equal(o.commandId, 'cmd-1'); assert.deepEqual(o.rosterResponse, { actor: 'Equipe', at: '2026-11-01T10:00:00.000Z' });
    assert.ok(!('noteUpdatedAt' in o), 'campo ausente deve ficar ausente');
    assert.notEqual(g1.j.revision, rev0);
  });
  await passo('GET devolve o que foi gravado e a revisão do tarólogo', async () => {
    const x = await ler();
    assert.deepEqual(x.j.overrides['osiris@2026-11-05'], g1.j.overrides['osiris@2026-11-05']);
    assert.equal(x.j.revisions.osiris, g1.j.revision);
    const f = await ler('?from=2026-12-01&to=2026-12-31');
    assert.deepEqual(f.j.overrides, {});
  });
  await passo('mesma chave e mesmo corpo repete a resposta sem gravar de novo', async () => {
    const antes = await contar('SELECT COUNT(*) AS n FROM gf_horarios_excecoes');
    const rep = await chamar('PUT', '/schedules/osiris/overrides', corpo1);
    assert.equal(rep.status, 200); assert.deepEqual(rep.j, g1.j);
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_horarios_excecoes'), antes);
  });
  await passo('mesma chave com outro corpo: 409 OPERATION_KEY_CONFLICT', async () => {
    const x = await chamar('PUT', '/schedules/osiris/overrides', { ...corpo1, override: ov('2026-11-06', '2026-11-06') });
    assert.equal(x.status, 409); assert.equal(x.j.error.code, 'OPERATION_KEY_CONFLICT');
  });
  await passo('revisão antiga: 409 VERSION_CHANGED, nada gravado', async () => {
    const antes = await contar('SELECT COUNT(*) AS n FROM gf_horarios_excecoes');
    const x = await colocar('osiris', ov('2026-11-07', '2026-11-07'), rev0);
    assert.equal(x.status, 409); assert.equal(x.j.error.code, 'VERSION_CHANGED'); assert.equal(x.j.error.message, 'Não foi possível salvar este horário. Reabra o lançamento e tente novamente.'); // texto do front
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_horarios_excecoes'), antes);
  });
  await passo('corrida: duas gravações com a mesma revisão, uma passa e a outra recebe 409', async () => {
    const rev = (await ler()).j.revisions.nyx || rev0;
    const [a, b] = await Promise.all([colocar('nyx', ov('2026-11-08', '2026-11-08'), rev), colocar('nyx', ov('2026-11-09', '2026-11-09'), rev)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.status}/${b.status}`);
  });
  let rev = (await ler()).j.revisions.osiris;
  await passo('intervalo no meio de outro preserva as pontas (regra do front) e o antigo vira histórico', async () => {
    let x = await colocar('osiris', ov('2026-11-10', '2026-11-20', { updatedAt: '2026-11-01T11:00:00' }), rev);
    x = await colocar('osiris', ov('2026-11-14', '2026-11-15', { updatedAt: '2026-11-01T12:00:00', todayHours: 'Folga', periods: [], absenceType: 'Folga estendida' }), x.j.revision);
    assert.equal(x.status, 200, x.t);
    assert.deepEqual(Object.keys(x.j.overrides).filter((k) => k !== 'osiris@2026-11-05').sort(), ['osiris@2026-11-10..2026-11-13', 'osiris@2026-11-14..2026-11-15', 'osiris@2026-11-16..2026-11-20']);
    assert.ok((await contar('SELECT COUNT(*) AS n FROM gf_horarios_excecoes WHERE removida_em IS NOT NULL')) >= 1);
    rev = x.j.revision;
  });
  await passo('turno com virada 06h e dois períodos gravam e voltam iguais', async () => {
    const x = await colocar('osiris', ov('2026-11-25', '2026-11-25', { periods: [{ start: '12:00', end: '15:00' }, { start: '22:00', end: '06:00' }], todayHours: '12h às 15h · 22h às 6h' }), rev);
    assert.equal(x.status, 200, x.t);
    assert.deepEqual(x.j.overrides['osiris@2026-11-25'].periods, [{ start: '12:00', end: '15:00' }, { start: '22:00', end: '06:00' }]);
    rev = x.j.revision;
  });
  await passo('períodos sobrepostos: 422 RULE_VIOLATION com a mensagem do front; corpo inválido: 400 INVALID_INPUT', async () => {
    const a = await colocar('osiris', ov('2026-11-26', '2026-11-26', { periods: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }] }), rev);
    assert.equal(a.status, 422); assert.equal(a.j.error.code, 'RULE_VIOLATION'); assert.equal(a.j.error.message, 'Os períodos não podem se sobrepor.');
    const b = await chamar('PUT', '/schedules/osiris/overrides', { operationKey: n() });
    assert.equal(b.status, 400); assert.equal(b.j.error.code, 'INVALID_INPUT');
    const c = await fetch(`${base}/schedules/osiris/overrides`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{quebrado' });
    assert.equal(c.status, 400);
  });
  await passo('DELETE da chave remove só ela; chave inexistente: 404', async () => {
    const x = await chamar('DELETE', `/schedules/osiris/overrides/${encodeURIComponent('osiris@2026-11-25')}`, { operationKey: n(), expectedRevision: rev });
    assert.equal(x.status, 200, x.t); assert.ok(!('osiris@2026-11-25' in x.j.overrides)); assert.ok('osiris@2026-11-14..2026-11-15' in x.j.overrides);
    const y = await chamar('DELETE', `/schedules/osiris/overrides/${encodeURIComponent('osiris@2030-01-01')}`, { operationKey: n(), expectedRevision: x.j.revision });
    assert.equal(y.status, 404); assert.equal(y.j.error.code, 'NOT_FOUND');
  });

  console.log('Escala semanal');
  await passo('PUT weekly grava, junta com o que já existia e aparece em GET profiles', async () => {
    const a = await chamar('PUT', '/schedules/osiris/weekly', { operationKey: n(), weeklySchedule: { segunda: '9h às 15h · 16h às 22h', domingo: 'Folga' } });
    assert.equal(a.status, 200, a.t);
    const b = await chamar('PUT', '/schedules/osiris/weekly', { operationKey: n(), weeklySchedule: { segunda: '10h às 15h' } });
    assert.deepEqual(b.j.weeklySchedule, { segunda: '10h às 15h', domingo: 'Folga' });
    const x = await ler();
    assert.deepEqual(x.j.profiles.find((p) => p.id === 'osiris').weeklySchedule, { segunda: '10h às 15h', domingo: 'Folga' });
    assert.equal((await chamar('PUT', '/schedules/osiris/weekly', { operationKey: n(), weeklySchedule: { segunda: 'qualquer coisa' } })).status, 422);
  });

  console.log('Perfis');
  await passo('equipe lê e grava qualquer tarólogo (administradora, assistente, supervisora, atendente)', async () => {
    for (const p of ['administradora', 'assistente', 'supervisora', 'atendente']) {
      como(p);
      assert.equal((await ler()).status, 200, p);
      const rv = (await ler()).j.revisions.estrela || rev0;
      assert.equal((await colocar('estrela', ov('2026-12-01', '2026-12-01', { updatedAt: `2026-11-01T1${['administradora', 'assistente', 'supervisora', 'atendente'].indexOf(p)}:00:00` }), rv)).status, 200, p);
    }
  });
  await passo('taróloga com tarotId: lê só o seu, grava só o seu; o de outra: 403 ACCESS_DENIED', async () => {
    como('tarologa', { tarotId: 'osiris' });
    const x = await ler();
    assert.equal(x.status, 200, x.t);
    assert.deepEqual(Object.keys(x.j.revisions), ['osiris']);
    assert.ok(Object.keys(x.j.overrides).every((k) => k.startsWith('osiris@')));
    assert.equal((await ler('?tarotId=nyx')).status, 403);
    const g = await colocar('osiris', ov('2026-12-02', '2026-12-02'), x.j.revisions.osiris);
    assert.equal(g.status, 200, g.t);
    const o = await colocar('nyx', ov('2026-12-02', '2026-12-02'), rev0);
    assert.equal(o.status, 403); assert.equal(o.j.error.code, 'ACCESS_DENIED');
    assert.equal((await chamar('PUT', '/schedules/nyx/weekly', { operationKey: n(), weeklySchedule: { segunda: '9h às 10h' } })).status, 403);
  });
  await passo('taróloga sem tarotId na sessão: 403 na leitura e na gravação', async () => {
    como('tarologa');
    assert.equal((await ler()).status, 403);
    assert.equal((await colocar('osiris', ov('2026-12-03', '2026-12-03'), rev0)).status, 403);
  });

  console.log('Auditoria, flags e legado');
  como('atendente');
  await passo('cada gravação de exceção e de escala deixou linha em gf_auditoria com ator, ação e antes/depois', async () => {
    const [l] = await sequelize.query("SELECT acao, ator_funcao, entidade, entidade_id, depois FROM gf_auditoria WHERE acao LIKE 'horarios.%' ORDER BY ocorrido_em");
    assert.ok(l.length >= 8, `${l.length} linhas`);
    assert.ok(l.every((x) => x.entidade === 'horarios' && ['atendente', 'administradora', 'assistente', 'supervisora', 'tarologa'].includes(x.ator_funcao)));
    const a = l.find((x) => x.acao === 'horarios.excecao.gravar' && x.entidade_id === 'osiris');
    assert.ok(a && a.depois && Object.keys(a.depois).length >= 1);
    assert.ok(l.some((x) => x.acao === 'horarios.excecao.remover') && l.some((x) => x.acao === 'horarios.semanal.gravar'));
  });
  await passo('as chaves gravaram em gf_operacoes (escopo horarios.*) e a repetição não duplicou a auditoria', async () => {
    const ops = await contar("SELECT COUNT(*) AS n FROM gf_operacoes WHERE escopo LIKE 'horarios.%'");
    const aud = await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao LIKE 'horarios.%'");
    assert.equal(ops, aud);
  });
  await passo('escrita desligada: leitura segue 200 e gravação responde 503 WRITE_DISABLED', async () => {
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
    try {
      assert.equal((await ler()).status, 200);
      const x = await colocar('osiris', ov('2026-12-09', '2026-12-09'), rev0);
      assert.equal(x.status, 503); assert.equal(x.j.error.code, 'WRITE_DISABLED');
    } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
  });
  await passo('fatia desligada em tempo de execução: 404', async () => {
    process.env.GF_FATIA_HORARIOS = 'false';
    try { assert.equal((await ler()).status, 404); } finally { process.env.GF_FATIA_HORARIOS = 'true'; }
  });
  await passo('nada foi pedido ao MySQL legado: tudo acima passou com o legado NÃO configurado neste processo', async () => {
    assert.equal(`${process.env.LEGADO_DB_HOST || ''}`, '');
    assert.equal(`${process.env.LEGADO_DB_NAME || ''}`, '');
  });

  srv.close();
  await sequelize.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres: ${ok} ok, ${falhas.length} falhas`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
