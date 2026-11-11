'use strict';
// Executa a regra e a junção REAIS do front contra a API. Sem rede, dados reais ou gravação de banco.
// node scripts/gerar-ouro-gf-retorno-clientes.js --front=/pasta/do/painel
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const assert = require('assert/strict');
const { abrir } = require('./apoio-gf-regras-b/front');
const { cenarios, linhasNovas, AGORA } = require('./apoio-gf-cadastro-manual/retorno-cenarios');
const api = require('../src/gestao-fadas/features/cadastros/tarologos-retorno.model');
const { lerConsultaLegado } = require('../src/gestao-fadas/features/consultas/helpers/leitura-legado');
const { montarRecorteConsultas } = require('../src/gestao-fadas/features/consultas/consultas.model');
const { timestampSaoPaulo } = require('../src/gestao-fadas/_comum/dia-operacional');
const front = (process.argv.find((a) => a.startsWith('--front=')) || '').slice(8);
if (!front) throw Error('Informe --front=/pasta/do/painel');
(async () => {
  const v = await abrir(front), clock = Date.now;
  Date.now = () => Date.parse(AGORA);
  try {
    const metric = await v.carregar('/features/tarologas/tarologist-session-metrics.ts');
    const mapping = await v.carregar('/features/integration/consultation/legacy-consultation-mapping.ts');
    const fmt = await v.carregar('/features/domain/formatters.ts');
    mapping.syncLegacyServerClock(AGORA, Date.parse(AGORA));
    const out = [];
    for (const caso of cenarios()) {
      const dto = montarRecorteConsultas({ rows: caso.antigas.map((r) => lerConsultaLegado(r)), range: { start: '0001-01-01', end: '2026-11-11' }, nowLocal: timestampSaoPaulo(new Date(caso.agora)) });
      const legadas = [...dto.finished, ...dto.inProgress, ...(dto.openSinceEarlier?.items || [])].map(mapping.legacyToOperational);
      const index = metric.buildSessionMetricIndex(mapping.mergeConsultations(caso.atuais, legadas));
      const hoje = '2026-11-11';
      const periodStart = index.sessions.filter((s) => s.date <= hoje).reduce((a, s) => s.date < a ? s.date : a, hoje);
      const rows = [...new Set(index.sessions.map((s) => s.tarotId))].sort().flatMap((tarologistId) => {
        const own = metric.ownSessionMetrics(index, periodStart, hoje, tarologistId);
        return own.uniqueClients ? [{ tarologistId, returnPercentage: own.clientPercentage, clients: own.uniqueClients, returningClients: own.returningClients }] : [];
      });
      const esperado = { periodStart, periodEnd: hoje, rows };
      const actual = api.montar(linhasNovas(caso.atuais), caso.antigas, new Date(caso.agora));
      assert.deepEqual({ periodStart: actual.periodStart, periodEnd: actual.periodEnd, rows: actual.rows }, esperado, caso.nome);
      out.push({ nome: caso.nome, esperado });
    }
    const files = ['features/tarologas/tarologist-session-metrics.ts', 'features/tarologas/tarologist-metrics-model.ts', 'features/integration/consultation/legacy-consultation-mapping.ts', 'features/domain/consultation-status.ts', 'features/domain/operation-calendar.ts'];
    const fontes = files.map((file) => ({ file, sha256: createHash('sha256').update(fs.readFileSync(path.join(front, file))).digest('hex') }));
    const destino = path.join(__dirname, 'apoio-gf-cadastro-manual/ouro-retorno-clientes.json');
    fs.writeFileSync(destino, `${JSON.stringify({ regra: 'buildSessionMetricIndex + ownSessionMetrics + mergeConsultations do front; DTO legado servido pela API', agora: AGORA, fontes, casos: out }, null, 2)}\n`);
    console.log(`Paridade API/front: ${out.length}/${out.length} cenários; ouro e hashes em ${destino}. Relógio São Paulo ${fmt.saoPauloTimestamp(new Date(AGORA))}.`);
  } finally { Date.now = clock; await v.fechar(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
