'use strict';
const assert = require('assert');
const service = require('../../src/gestao-fadas/features/cadastros/tarologos-retorno.service');
const model = require('../../src/gestao-fadas/features/cadastros/tarologos-retorno.model');
const { cenarios, linhasNovas } = require('./retorno-cenarios');
const ouro = require('./ouro-retorno-clientes.json');
const legado = (id, cliente, inicio) => ({ idConsulta: id, idUsuario: cliente, idTarologo: 9001, iniConsulta: `${inicio}:00`, fimConsulta: `${inicio}:00`.replace(':00:00', ':15:00'), tmpConsulta: 15 });

module.exports = async (a, { passo, status }) => {
  const caminho = '/catalog/tarologists/return-metrics';
  const flags = ['GF_FATIA_CADASTROS', 'GF_NOVOS_DADOS', 'GESTAO_FADAS_ESCRITA_ENABLED'];
  const anterior = Object.fromEntries(flags.map((f) => [f, process.env[f]]));
  const inserir = async (id, cliente, profissional, inicio, extra = {}) => {
    const item = { id, clientId: cliente, tarotId: profissional, status: 'Concluída', durationSeconds: 900, awaitingTarologistStart: false,
      startedAt: `${inicio}:00-03:00`, endedAt: `${inicio}:00-03:00`.replace(':00:00', ':15:00'), ...extra };
    await a.sql('INSERT INTO gf_consultas_ext (id,id_cliente,id_tarologo,id_consulta_legado,status,comissao_percentual,aguardando_inicio,iniciada_em,encerrada_em,duracao_segundos,item,criado_por,operation_key) VALUES (?,?,?,?,?,0,false,?,?,900,?::jsonb,?,?)',
      [id, cliente, profissional, item.legacyConsultationId || null, item.status, item.startedAt, item.endedAt, JSON.stringify(item), 'Equipe teste manual', `retorno-${id}`]);
    return item;
  };
  try {
    await passo('paridade de retorno com ouro executado no frontend: sessões, continuação, espelho e calendário', async () => {
      const casos = cenarios(); assert.equal(casos.length, ouro.casos.length);
      for (const [i, caso] of casos.entries()) {
        assert.equal(caso.nome, ouro.casos[i].nome);
        const actual = model.montar(linhasNovas(caso.atuais), caso.antigas, new Date(caso.agora));
        assert.deepEqual({ periodStart: actual.periodStart, periodEnd: actual.periodEnd, rows: actual.rows }, ouro.casos[i].esperado, caso.nome);
      }
    });
    await passo('agregado de retorno junta legado e PostgreSQL; continuações e espelho não duplicam clientes', async () => {
      a.consultasLegadas.push(legado(501, 7001, '2020-01-01T10:00'), legado(502, 7002, '2020-01-01T11:00'), legado(503, 7003, '2020-01-01T12:00'));
      await inserir('return-1', '7001', '9001', '2020-01-02T10:00');
      await inserir('return-extension', '7001', '9001', '2020-01-02T10:20', { endedAt: '2020-01-02T10:35:00-03:00', continuation: { kind: 'extension', sourceConsultationId: 'return-1' } });
      await inserir('return-annulled', '7003', '9001', '2020-01-01T12:00', { status: 'Anulada', legacyConsultationId: '503' });
      await inserir('return-first', '8001', '9002', '2020-01-03T10:00');
      service.limparCache(); const x = await a.chamar('GET', caminho); status(x, 200);
      assert.equal(x.j.complete, true); assert.equal(x.j.metric, 'returning_clients_percentage');
      assert.deepEqual(x.j.rows, [{ tarologistId: '9001', returnPercentage: 50, clients: 2, returningClients: 1 }, { tarologistId: '9002', returnPercentage: 0, clients: 1, returningClients: 0 }]);
      assert.equal(x.j.periodStart, '2020-01-01'); assert.ok(x.j.periodEnd >= '2020-01-03');
      assert.equal(x.j.items, undefined); assert.equal(x.j.consultations, undefined);
      assert.doesNotMatch(JSON.stringify(x.j), /clientId|startedAt|7001|return-extension/);
      assert.equal(a.chamadas.escritas, 0);
    });
    if (process.env.GF_RETORNO_FRONT) await passo('call do frontend real atravessa /api e gate HTTP até o agregado', async () => {
      const { abrir } = require('../apoio-gf-regras-b/front');
      const front = await abrir(process.env.GF_RETORNO_FRONT), originalFetch = globalThis.fetch, calls = [];
      try {
        const { call } = await front.carregar('/features/auth/real-session.ts');
        const { clientTarotPaths, parseClientTarotReturns } = await front.carregar('/features/integration/clients/use-real-client-tarots.ts');
        const expected = (await a.chamar('GET', caminho)).j.rows;
        globalThis.fetch = async (url, init) => {
          assert.equal(url, '/api/catalog/tarologists/return-metrics');
          assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store');
          calls.push(url);
          return originalFetch(new URL(url, a.origem), { ...init, headers: { cookie: 'fixture-session=cmn', origin: a.origem } });
        };
        const answer = await call(clientTarotPaths.returns);
        assert.equal(answer.status, 200); assert.deepEqual(parseClientTarotReturns(answer.body).rows, expected);
        a.como('tarologa'); assert.equal((await call(clientTarotPaths.returns)).status, 403);
        a.sessao('absent'); assert.equal((await call(clientTarotPaths.returns)).status, 401);
        assert.equal(calls.length, 3);
      } finally { globalThis.fetch = originalFetch; a.como(); await front.fechar(); }
    });
    await passo('métrica sem sessão é ausente, não zero; fontes de mesma cliente/profissional/minuto são deduplicadas', async () => {
      assert.deepEqual(model.agregadoDeRegistros([], new Date('2026-11-10T15:00:00Z')).rows, []);
      const antiga = model.doLegado(legado(88, 7001, '2020-01-01T10:00'));
      const nova = { ...antiga, id: 'novo-sem-vinculo', legacyConsultationId: undefined };
      assert.equal(model.unir([nova], [antiga, antiga]).length, 1);
      const outro = { ...nova, id: 'outro', clientId: '7002' };
      assert.equal(model.unir([outro], [antiga]).length, 2);
    });
    await passo('retorno preserva sessão e perfis; leitura funciona com escrita desligada', async () => {
      for (const role of ['administradora', 'assistente', 'supervisora', 'atendente']) { a.como(role); status(await a.chamar('GET', caminho), 200); }
      a.como('tarologa'); status(await a.chamar('GET', caminho), 403, 'ACCESS_DENIED');
      a.sessao('absent'); status(await a.chamar('GET', caminho), 401, 'SESSION_REQUIRED'); a.como();
      process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
      try { status(await a.chamar('GET', caminho), 200); } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
      process.env.GF_FATIA_CADASTROS = 'false';
      try { status(await a.chamar('GET', caminho), 404, 'NOT_FOUND'); } finally { process.env.GF_FATIA_CADASTROS = 'true'; }
      process.env.GF_NOVOS_DADOS = 'mysql';
      try { status(await a.chamar('GET', caminho), 503); } finally { process.env.GF_NOVOS_DADOS = 'postgres'; }
    });
    await passo('falha de uma fonte ou limite excedido não retorna percentual calculado de recorte', async () => {
      service.limparCache(); a.chamadas.falharLeitura = true;
      try { const x = await a.chamar('GET', caminho); status(x, 503); assert.equal(x.j.rows, undefined); } finally { a.chamadas.falharLeitura = false; }
      const antes = a.consultasLegadas.length; a.consultasLegadas.length = service.LIMITE + 1;
      service.limparCache();
      try { const x = await a.chamar('GET', caminho); status(x, 503); assert.equal(x.j.rows, undefined); } finally { a.consultasLegadas.length = antes; service.limparCache(); }
      const m = a.sequelize.models.GfConsultasExt, original = m.findAll;
      m.findAll = async () => { throw Object.assign(new Error('Postgres indisponível no teste'), { name: 'SequelizeConnectionError' }); };
      try { const x = await a.chamar('GET', caminho); status(x, 503); assert.equal(x.j.rows, undefined); } finally { m.findAll = original; service.limparCache(); }
    });
  } finally {
    a.como(); a.consultasLegadas.length = 0; service.limparCache();
    for (const [flag, value] of Object.entries(anterior)) { if (value === undefined) delete process.env[flag]; else process.env[flag] = value; }
  }
};
