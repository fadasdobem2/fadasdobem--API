'use strict';

/**
 * FILHO de scripts/verificar-gf-pendencias.js: roda contra o Postgres DESCARTÁVEL (fdb_pen_*) já migrado, com DB_* só no ambiente deste processo.
 * Prova pelo HTTP do gate (sessão de mentira, usuários reais da A no banco; o MySQL legado NÃO é configurado): leitura por perfil, encaminhar e
 * devolver (quem pode), carimbo do servidor, resolvida e reaberta, revisão otimista (409), idempotência, corrida, visibilidade (financeira),
 * auditoria, escrita desligada, taróloga recusada e as fontes do Painel intactas.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_PENDENCIAS: 'true',
});
delete process.env.GF_LEGADO_ESCRITA_ENABLED;
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const u = { atend: await criarUsuario('Atendente Pen'), adm: await criarUsuario('Administradora Pen'), sup: await criarUsuario('Supervisora Pen'), assist: await criarUsuario('Assistente Pen'), tar: await criarUsuario('Tarologa Pen') };
  let sessao = { userId: u.atend, role: 'atendente', displayName: 'Khloe' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-pen' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 300), h: resp.headers };
  };
  const como = (perfil) => {
    const mapa = { atendente: [u.atend, 'Khloe'], administradora: [u.adm, 'Laya'], supervisora: [u.sup, 'Clara'], assistente: [u.assist, 'Assist'], tarologa: [u.tar, 'Osíris'] };
    const [userId, displayName] = mapa[perfil];
    sessao = { userId, role: perfil, displayName, ...(perfil === 'tarologa' ? { tarotId: '9001' } : {}) };
  };
  const n = () => { n.i = (n.i || 0) + 1; return `op-pen-${Date.now()}-${n.i}`; };
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);
  const gravar = (record, expectedVersion, operationKey = n()) => chamar('PUT', '/pending-routing', { operationKey, expectedVersion, record });
  const ler = () => chamar('GET', '/pending-routing');
  const snap = (id, extra = {}) => ({ id, occurrence: 'occ-1', financial: false, tone: 'divergence', title: 'Divergência na consulta', who: '900013 · Cliente Ficção', detail: 'Osíris · 10 min registrados', ...extra });
  const chave = (s) => JSON.stringify([s.id, s.occurrence]);
  const evento = (de, para, acao, motivo = 'Conferir isto.') => ({ at: '2000-01-01T00:00:00.000Z', actor: { id: 'Hacker', name: 'Hacker', role: 'administradora' }, action: acao, from: de, to: para, reason: motivo });
  const reg = (s, fila, eventos = [], extra = {}) => ({ key: chave(s), snapshot: s, queue: fila, events: eventos, ...extra });

  console.log('Esquema');
  await passo('a tabela existe, tem os CHECKs e a migração roda de novo sem erro', async () => {
    assert.equal(await contar("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_name = 'gf_pendencias_encaminhamentos'"), 1);
    assert.ok(await contar("SELECT COUNT(*) AS n FROM pg_constraint WHERE conname LIKE 'chk_pendencias_%'") >= 6);
    await require(r('migrations/20261119000000-gestao-fadas-pendencias')).up({ sequelize });
    await assert.rejects(() => sequelize.query("INSERT INTO gf_pendencias_encaminhamentos (chave, fila, item, criado_por, operation_key) VALUES ('x', 'outra', '{}', 'a', 'op-xxxxxxxx')"));
  });

  console.log('Leitura e perfis');
  await passo('GET vazio: 200, DTO puro, no-store; a taróloga é recusada (403)', async () => {
    como('atendente');
    const x = await ler(); assert.equal(x.status, 200, x.t); assert.deepEqual(x.j.items, []); assert.deepEqual(x.j.versions, {}); assert.ok(!('sucesso' in x.j)); assert.equal(x.h.get('cache-control'), 'no-store');
    como('tarologa');
    const t = await ler(); assert.equal(t.status, 403); const g = await gravar(reg(snap('divergence:d1'), 'supervisao', [evento('atendimento', 'supervisao', 'forward')]), 0); assert.equal(g.status, 403);
    como('atendente');
  });

  console.log('Encaminhar, devolver, resolver');
  const s1 = snap('divergence:d1');
  const chaveFwd = n();
  await passo('a atendente encaminha à Supervisão: o servidor carimba autor e instante e devolve versão 1', async () => {
    const x = await gravar(reg(s1, 'supervisao', [evento('atendimento', 'supervisao', 'forward', '  Preciso da decisão.  ')]), 0, chaveFwd);
    assert.equal(x.status, 200, x.t); assert.equal(x.j.versions[chave(s1)], 1);
    const e = x.j.items.find((i) => i.key === chave(s1)).events[0]; assert.equal(e.actor.name, 'Khloe'); assert.equal(e.actor.role, 'atendente'); assert.notEqual(e.actor.id, 'Hacker'); assert.notEqual(e.at, '2000-01-01T00:00:00.000Z'); assert.equal(e.reason, 'Preciso da decisão.');
    assert.equal(await contar(`SELECT COUNT(*) AS n FROM gf_pendencias_encaminhamentos WHERE fila = 'supervisao' AND NOT resolvida`), 1);
  });
  await passo('mesma chave e corpo repete a resposta sem gravar de novo; mesma chave com outro corpo é 409 OPERATION_KEY_CONFLICT', async () => {
    const x = await gravar(reg(s1, 'supervisao', [evento('atendimento', 'supervisao', 'forward', '  Preciso da decisão.  ')]), 0, chaveFwd); assert.equal(x.status, 200, x.t); assert.equal(x.j.versions[chave(s1)], 1);
    const y = await gravar(reg(s1, 'supervisao', [evento('atendimento', 'supervisao', 'forward', 'Outro texto.')]), 0, chaveFwd); assert.equal(y.status, 409); assert.equal(y.j.error.code, 'OPERATION_KEY_CONFLICT');
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_pendencias_encaminhamentos'), 1);
  });
  await passo('versão velha: 409 VERSION_CHANGED, nada muda', async () => {
    const x = await gravar(reg(s1, 'supervisao', [evento('atendimento', 'supervisao', 'forward')]), 0); assert.equal(x.status, 409); assert.equal(x.j.error.code, 'VERSION_CHANGED');
  });
  await passo('a Supervisão e a Administradora leem o encaminhamento; a atendente não devolve o que não é dela', async () => {
    como('supervisora'); let x = await ler(); assert.equal(x.j.items.length, 1);
    como('administradora'); x = await ler(); assert.equal(x.j.versions[chave(s1)], 1);
    como('atendente'); const antes = (await ler()).j.items.find((i) => i.key === chave(s1));
    const y = await gravar({ ...antes, queue: 'atendimento', events: [...antes.events, evento('supervisao', 'atendimento', 'return')] }, 1); assert.equal(y.status, 422, y.t);
    assert.match(y.j.error.message, /Seu perfil não pode fazer esse encaminhamento/);
  });
  await passo('a Supervisão devolve ao Atendimento com orientação; o histórico cresce e a versão sobe', async () => {
    como('supervisora'); const antes = (await ler()).j.items.find((i) => i.key === chave(s1));
    const x = await gravar({ ...antes, queue: 'atendimento', events: [...antes.events, evento('supervisao', 'atendimento', 'return', 'Pode seguir.')] }, 1);
    assert.equal(x.status, 200, x.t); const rr = x.j.items.find((i) => i.key === chave(s1)); assert.equal(rr.events.length, 2); assert.equal(rr.events[1].actor.name, 'Clara'); assert.equal(x.j.versions[chave(s1)], 2);
  });
  await passo('histórico apagado, dois eventos de uma vez, motivo vazio e fila trocada sem evento são recusados (422)', async () => {
    const antes = (await ler()).j.items.find((i) => i.key === chave(s1));
    for (const mut of [{ ...antes, events: [] }, { ...antes, queue: 'financeiro' }, { ...antes, queue: 'supervisao', events: [...antes.events, evento('atendimento', 'supervisao', 'forward', '   ')] }, { ...antes, queue: 'supervisao', events: [...antes.events, evento('atendimento', 'supervisao', 'forward'), evento('supervisao', 'atendimento', 'return')] }]) {
      como('atendente'); const x = await gravar(mut, 2); assert.equal(x.status, 422, x.t);
    }
  });
  await passo('resolvida e reaberta pela origem (Sistema): a fila volta à inicial e o histórico guarda os dois eventos', async () => {
    como('atendente'); const antes = (await ler()).j.items.find((i) => i.key === chave(s1));
    let x = await gravar({ ...antes, resolvedAt: '2000-01-01T00:00:00.000Z', events: [...antes.events, evento('atendimento', 'atendimento', 'resolved', 'x')] }, 2);
    assert.equal(x.status, 200, x.t); let rr = x.j.items.find((i) => i.key === chave(s1)); assert.ok(rr.resolvedAt); assert.equal(rr.events.at(-1).actor.name, 'Sistema'); assert.match(rr.events.at(-1).reason, /deixou de exigir conferência/);
    const y = await gravar({ ...rr, queue: 'supervisao', events: [...rr.events, evento('atendimento', 'supervisao', 'forward')] }, 3); assert.equal(y.status, 422); assert.match(y.j.error.message, /já foi resolvida/);
    x = await gravar({ ...rr, resolvedAt: undefined, events: [...rr.events, evento('atendimento', 'atendimento', 'reopened', 'x')] }, 3); assert.equal(x.status, 200, x.t); rr = x.j.items.find((i) => i.key === chave(s1));
    assert.ok(!rr.resolvedAt); assert.equal(rr.queue, 'atendimento'); assert.equal(rr.events.length, 4); assert.equal(x.j.versions[chave(s1)], 4);
  });

  console.log('Origem derivada no servidor (Maturacao/35)');
  const orig = require(r('src/gestao-fadas/features/pendencias/pendencias.origem'));
  const consulta = (id, extra = {}) => ({ id, clientId: '900013', client: 'Cliente Ficção', tarotId: 't1', tarot: 'Osíris', status: 'Em curso', startedAt: '2026-10-30T12:00:00.000Z', durationSeconds: 600, audit: [], tarologistFinishReport: { submittedAt: '2026-10-30T12:20:00.000Z', minutes: 18 }, ...extra });
  let mundo = { consultas: [consulta('K-orig-1')], agenda: [], pagamentos: [], divergencias: [] };
  orig.definirLeitorDeFontes(async () => JSON.parse(JSON.stringify(mundo)));
  const derivada = async () => (await chamar('GET', '/pending-routing/derived')).j;
  await passo('GET /pending-routing/derived mostra o que o servidor deriva (encerramento informado), por perfil', async () => {
    como('atendente'); const x = await chamar('GET', '/pending-routing/derived'); assert.equal(x.status, 200, x.t);
    const it = x.j.items.find((i) => i.id === 'finish:K-orig-1'); assert.ok(it, x.t); assert.equal(it.tone, 'finish'); assert.equal(it.detail, 'Osíris · 18 min informados'); assert.equal(it.who, '900013 · Cliente Ficção');
    como('tarologa'); assert.equal((await chamar('GET', '/pending-routing/derived')).status, 403);
    como('atendente');
  });
  const alvo = async () => (await derivada()).items.find((i) => i.id === 'finish:K-orig-1');
  await passo('encaminhar a pendência derivada com o snapshot do servidor: 200; snapshot adulterado: 409 com o texto do front; pendência que não existe: 409', async () => {
    const s = await alvo(); const ruim = { ...s, detail: 'Outro detalhe' };
    let x = await gravar(reg(ruim, 'supervisao', [evento('atendimento', 'supervisao', 'forward')]), 0); assert.equal(x.status, 409, x.t); assert.equal(x.j.error.code, 'VERSION_CHANGED'); assert.equal(x.j.error.message, 'A pendência mudou. Atualize a lista e tente novamente.');
    const fantasma = snap('finish:nao-existe', { tone: 'finish' });
    x = await gravar(reg(fantasma, 'supervisao', [evento('atendimento', 'supervisao', 'forward')]), 0); assert.equal(x.status, 409, x.t); assert.equal(x.j.error.message, 'Esta pendência não está mais disponível.');
    assert.equal(await contar(`SELECT COUNT(*) AS n FROM gf_pendencias_encaminhamentos WHERE chave LIKE '%nao-existe%'`), 0);
    x = await gravar(reg(s, 'supervisao', [evento('atendimento', 'supervisao', 'forward', 'Confira.')]), 0); assert.equal(x.status, 200, x.t);
  });
  await passo('resolvida: recusada enquanto a origem ainda exige conferência; aceita quando a consulta continua lida e já foi conferida (fora da leitura não resolve); reaberta só quando ela volta', async () => {
    const antes = (await ler()).j.items.find((i) => i.snapshot.id === 'finish:K-orig-1'); const ver = (await ler()).j.versions[antes.key];
    const resolvida = { ...antes, resolvedAt: '2000-01-01T00:00:00.000Z', events: [...antes.events, evento('supervisao', 'supervisao', 'resolved', 'x')] };
    let x = await gravar(resolvida, ver); assert.equal(x.status, 409, `resolver com origem: ${x.t}`); assert.equal(x.j.error.code, 'VERSION_CHANGED');
    mundo = { ...mundo, consultas: [] };
    x = await gravar(resolvida, ver); assert.equal(x.status, 409, `origem fora da leitura não resolve (regra originIds do front): ${x.t}`);
    mundo = { ...mundo, consultas: [consulta('K-orig-1', { finishReview: { at: '2026-10-30T12:40:00.000Z' } })] };
    x = await gravar(resolvida, ver); assert.equal(x.status, 200, `resolver: ${x.t}`); const rr = x.j.items[0]; assert.ok(rr.resolvedAt); assert.equal(rr.events.at(-1).actor.name, 'Sistema');
    const reaberta = { ...rr, queue: 'atendimento', resolvedAt: undefined, events: [...rr.events, evento('supervisao', 'atendimento', 'reopened', 'x')] };
    x = await gravar(reaberta, ver + 1); assert.equal(x.status, 409, x.t); // a origem ainda não voltou
    mundo = { ...mundo, consultas: [consulta('K-orig-1')] };
    x = await gravar(reaberta, ver + 1); assert.equal(x.status, 200, `reabrir: ${x.t}`); assert.ok(!x.j.items[0].resolvedAt); assert.equal(x.j.items[0].events.at(-1).action, 'reopened');
  });
  await passo('financeira derivada (cancelamento): a atendente não a vê na derivação; a administradora vê', async () => {
    mundo = { ...mundo, consultas: [consulta('K-orig-2', { tarologistFinishReport: undefined, status: 'Cancelada', cancellationReview: { status: 'pending', requestedAt: '2026-10-30T12:30:00.000Z', complaint: 'Reclamou.' } })] };
    como('atendente'); assert.equal((await derivada()).items.find((i) => i.id === 'cancellation:K-orig-2'), undefined);
    como('administradora'); const c = (await derivada()).items.find((i) => i.id === 'cancellation:K-orig-2'); assert.ok(c); assert.equal(c.financial, true);
    como('atendente');
  });
  console.log('Orientação financeira derivada (Maturacao/41)');
  const guid = (reason = 'Dívida antiga.', extra = {}) => ({ revision: 1, active: true, requiresApproval: true, pendingReview: true, reason, by: 'Khloe', at: '2026-10-30T12:00:00.000Z', history: [{ id: 'ev-g1', action: 'request', reason, by: 'Khloe', role: 'atendente', at: '2026-10-30T12:00:00.000Z' }], ...extra });
  mundo = { consultas: [], agenda: [], pagamentos: [], divergencias: [], orientacoes: [{ clientId: '900033', nome: 'Cliente Ficção', guidance: guid() }] };
  await passo('GET /pending-routing/derived lista a orientação da ficha como o front (guidance:<cliente>, ligada ao último pedido)', async () => {
    como('atendente'); const it = (await derivada()).items.find((i) => i.id === 'guidance:900033');
    assert.ok(it); assert.equal(it.occurrence, 'ev-g1'); assert.equal(it.tone, 'guidance'); assert.equal(it.who, '900033 · Cliente Ficção'); assert.equal(it.detail, 'Dívida antiga.'); assert.equal(it.financial, false); assert.ok(!('referenceDate' in it));
  });
  await passo('semente: com o snapshot do servidor 200; snapshot adulterado e orientação que não existe são recusados (422) e nada é gravado', async () => {
    como('atendente'); const it = (await derivada()).items.find((i) => i.id === 'guidance:900033');
    for (const ruim of [{ ...it, detail: 'Outro texto' }, { ...it, who: '900033 · Fantasma' }, { ...it, occurrence: 'ev-x' }, snap('guidance:900099', { tone: 'guidance', occurrence: 'ev-g1' })]) {
      const x = await gravar(reg(ruim, 'supervisao', []), 0); assert.equal(x.status, 422, x.t);
    }
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_pendencias_encaminhamentos WHERE chave LIKE '%guidance:9000%' AND chave LIKE '%ev-%'"), 0);
    const x = await gravar(reg(it, 'supervisao', []), 0); assert.equal(x.status, 200, x.t);
  });
  await passo('resolvida: recusada (409) enquanto a orientação ainda pede revisão; aceita quando a supervisora a libera', async () => {
    const antes = (await ler()).j.items.find((i) => i.snapshot.id === 'guidance:900033'); const ver = (await ler()).j.versions[antes.key];
    const resolvida = { ...antes, resolvedAt: '2000-01-01T00:00:00.000Z', events: [...antes.events, evento('supervisao', 'supervisao', 'resolved', 'x')] };
    let x = await gravar(resolvida, ver); assert.equal(x.status, 409, x.t); assert.equal(x.j.error.message, 'A pendência mudou. Atualize a lista e tente novamente.');
    mundo = { ...mundo, orientacoes: [{ clientId: '900033', nome: 'Cliente Ficção', guidance: guid('Dívida antiga.', { revision: 2, active: false, pendingReview: false, history: [...guid().history, { id: 'ev-g2', action: 'release', reason: 'Liberada.', by: 'Clara', role: 'supervisora', at: '2026-10-30T13:00:00.000Z' }] }) }] };
    x = await gravar(resolvida, ver); assert.equal(x.status, 200, x.t); assert.ok(x.j.items[0].resolvedAt); assert.equal(x.j.items[0].events.at(-1).actor.name, 'Sistema');
  });
  await passo('o servidor lê as orientações do banco (gf_clientes_orientacoes) com o nome da ficha: nome editado vence o do legado; cliente fora do legado não entra', async () => {
    orig.definirLeitorDeFontes(null);
    const ctxm = require(r('src/gestao-fadas/features/financeiro-cliente/fin.contexto'));
    ctxm.definirLeitorDePartida(async (ids) => new Map(ids.filter((id) => ['900044', '900045'].includes(id)).map((id) => [id, { centavos: 0, conhecido: true, nome: 'Legado ' + id }])));
    const antigos = ['GF_FATIA_PAGAMENTOS', 'GF_FATIA_DIVERGENCIAS', 'GF_FATIA_FICHA'].map((k) => [k, process.env[k]]);
    Object.assign(process.env, { GF_FATIA_PAGAMENTOS: 'true', GF_FATIA_DIVERGENCIAS: 'true', GF_FATIA_FICHA: 'true' });
    try {
      for (const id of ['900044', '900045', '900046']) await sequelize.query('INSERT INTO gf_clientes_orientacoes (id_cliente, revisao, ativa, pendente, item, atualizado_por, operation_key) VALUES (?, 1, true, true, ?, ?, ?)', { replacements: [id, JSON.stringify(guid('Motivo ' + id)), 'Khloe', 'op-ori-' + id + '-xxxx'] });
      await sequelize.query("INSERT INTO gf_clientes_ext (id_cliente, dados, revisao, atualizado_por, operation_key) VALUES ('900045', '{\"name\":\"Nome Editado\"}', 1, 'Khloe', 'op-ext-900045-xxxx')");
      como('atendente'); const lista = (await derivada()).items.filter((i) => i.tone === 'guidance');
      assert.equal(lista.find((i) => i.id === 'guidance:900044').who, '900044 · Legado 900044'); assert.equal(lista.find((i) => i.id === 'guidance:900045').who, '900045 · Nome Editado');
      assert.equal(lista.find((i) => i.id === 'guidance:900046'), undefined, 'sem cadastro no legado não há perfil, como no front');
    } finally { antigos.forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }); ctxm.definirLeitorDePartida(null); }
  });
  orig.definirLeitorDeFontes(null);

  console.log('Visibilidade, corrida e escrita');
  const fin = snap('payment:p1', { financial: true, tone: 'payment' });
  await passo('financeira: a assistente encaminha à Administração; atendente e supervisora não a veem nem a gravam (403)', async () => {
    como('assistente');
    const x = await gravar(reg(fin, 'administracao', [evento('financeiro', 'administracao', 'forward', 'Administração decide.')]), 0); assert.equal(x.status, 200, x.t);
    como('atendente'); const l = await ler(); assert.equal(l.j.items.find((i) => i.key === chave(fin)), undefined);
    const antes = x.j.items.find((i) => i.key === chave(fin));
    const y = await gravar({ ...antes, queue: 'financeiro', events: [...antes.events, evento('administracao', 'financeiro', 'return')] }, 1); assert.equal(y.status, 403, y.t);
    como('supervisora'); assert.equal((await ler()).j.items.find((i) => i.key === chave(fin)), undefined);
    como('administradora'); assert.ok((await ler()).j.items.find((i) => i.key === chave(fin)));
  });
  await passo('corrida: duas gravações com a mesma versão, uma vence e a outra é 409', async () => {
    como('atendente'); const s = snap('divergence:c1');
    const [a, b] = await Promise.all([gravar(reg(s, 'supervisao', [evento('atendimento', 'supervisao', 'forward', 'A')]), 0), gravar(reg(s, 'supervisao', [evento('atendimento', 'supervisao', 'forward', 'B')]), 0)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.t} | ${b.t}`);
    assert.equal(await contar(`SELECT COUNT(*) AS n FROM gf_pendencias_encaminhamentos WHERE chave = '${chave(s)}'`), 1);
  });
  await passo('regras por perfil: a atendente não encaminha financeira nem à Administração; cancelamento e orientação não são encaminhados', async () => {
    como('atendente');
    const f2 = snap('payment:p2', { financial: true, tone: 'payment' }); let x = await gravar(reg(f2, 'supervisao', [evento('financeiro', 'supervisao', 'forward')]), 0); assert.ok([403, 422].includes(x.status), x.t);
    const m = snap('match:m1', { tone: 'match' }); x = await gravar(reg(m, 'administracao', [evento('atendimento', 'administracao', 'forward')]), 0); assert.equal(x.status, 422);
    como('administradora'); const c = snap('cancellation:c1', { financial: true, tone: 'cancellation' }); x = await gravar(reg(c, 'atendimento', [evento('administracao', 'atendimento', 'return')]), 0); assert.equal(x.status, 422);
    const g = snap('guidance:900013', { tone: 'guidance' }); x = await gravar(reg(g, 'supervisao', []), 0); assert.equal(x.status, 200, x.t); // semente da orientação (fila inicial, sem evento)
    x = await gravar(reg(snap('match:m2', { tone: 'match' }), 'supervisao', []), 0); assert.equal(x.status, 422, x.t); // sem evento, fora da fila inicial
  });
  await passo('corpo ruim: chave que não bate, fila fora da lista, operationKey curta e JSON quebrado são recusados', async () => {
    como('atendente'); const s = snap('divergence:z1');
    let x = await gravar({ ...reg(s, 'supervisao', [evento('atendimento', 'supervisao', 'forward')]), key: '["x","y"]' }, 0); assert.equal(x.status, 422);
    x = await gravar(reg(s, 'lixo', []), 0); assert.equal(x.status, 422);
    x = await chamar('PUT', '/pending-routing', { operationKey: 'curta', expectedVersion: 0, record: reg(s, 'atendimento') }); assert.equal(x.status, 400, x.t);
    const resp = await fetch(`${base}/pending-routing`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{' }); assert.equal(resp.status, 400);
  });
  await passo('auditoria: uma linha por gravação aplicada, na mesma transação (sem linha para recusa)', async () => {
    assert.ok(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'pendencias.gravar'") >= 7);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_operacoes WHERE escopo = 'pendencias.gravar'"), await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'pendencias.gravar'"));
  });
  await passo('gravação desligada no ambiente: 503 WRITE_DISABLED e nada é gravado; a leitura segue', async () => {
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false'; como('atendente');
    const antes = await contar('SELECT COUNT(*) AS n FROM gf_pendencias_encaminhamentos');
    try { const x = await gravar(reg(snap('divergence:w1'), 'supervisao', [evento('atendimento', 'supervisao', 'forward')]), 0); assert.equal(x.status, 503); assert.equal(x.j.error.code, 'WRITE_DISABLED'); assert.equal((await ler()).status, 200); } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_pendencias_encaminhamentos'), antes);
  });
  await passo('o legado não é tocado: nenhuma escrita no MySQL (não configurado aqui)', async () => { assert.equal(process.env.GF_LEGADO_ESCRITA_ENABLED, undefined); });

  como('administradora');

  await passo('janela opcional em GET /pending-routing: sem parâmetros nada muda; limit/after paginam na mesma ordem, com nextCursor; parâmetro ruim é 400', async () => {
    const todas = await chamar('GET', '/pending-routing'); assert.equal(todas.status, 200, todas.t); const n0 = todas.j.items.length; assert.ok(!('nextCursor' in todas.j), 'sem limit não há nextCursor');
    if (n0 < 2) { console.log('        (menos de 2 itens: só o contrato padrão foi conferido)'); return; }
    const p1 = await chamar('GET', '/pending-routing?limit=1'); assert.equal(p1.status, 200, p1.t); assert.equal(p1.j.items.length, 1); assert.ok(p1.j.nextCursor, 'tem próxima página'); assert.equal(((x) => x.key)(p1.j.items[0]), ((x) => x.key)(todas.j.items[0]));
    const p2 = await chamar('GET', '/pending-routing?limit=1&after=' + encodeURIComponent(p1.j.nextCursor)); assert.equal(p2.status, 200, p2.t); assert.equal(((x) => x.key)(p2.j.items[0]), ((x) => x.key)(todas.j.items[1]));
    const tudo = await chamar('GET', '/pending-routing?limit=1000'); assert.equal(tudo.j.items.length, n0); assert.equal(tudo.j.nextCursor, null);
    for (const ruim of ['limit=0', 'limit=abc', 'limit=1001', 'after=nao-existe-xyz']) assert.equal((await chamar('GET', '/pending-routing?' + ruim)).status, 400, ruim);
  });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close().catch(() => {});
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
