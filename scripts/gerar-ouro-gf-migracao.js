'use strict';

/**
 * Gera o OURO da migração por planilha (Maturacao/55) A PARTIR DO CÓDIGO REAL DO FRONT: `client-migration-history-model.ts`
 * (`validClientMigrationHistory`, `migrationOpeningCents`, `migrationEventAfterCutoff`, `migrationOpeningOffset`, `migrationCurrentStory`,
 * `appendClientMigrationHistories`), `migration-model.ts#parseMigrationDate`, `finance/account-story.ts#clientAccountStory` e `finance/cash-ledger.ts#clientCashAccount`.
 * Usa os cenários de pagamentos e consultas do ouro financeiro (scripts/apoio-gf-financeiro/cenarios.js) e sorteia cortes, créditos e débitos com semente fixa.
 * Grava scripts/apoio-gf-migracao/ouro-migracao-front.json. Nada no front é alterado; todo valor é fictício.
 *   node scripts/gerar-ouro-gf-migracao.js --front=<pasta do FRONT com node_modules>
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { gerarCenarios } = require('./apoio-gf-financeiro/cenarios');

const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const front = path.resolve(arg('front') || '');
if (!arg('front') || !fs.existsSync(path.join(front, 'node_modules', 'vite'))) { console.error('Informe --front=<pasta do FRONT com node_modules>.'); process.exit(2); }

function semente(n) {
  let a = n >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r = semente(20261031);
const pick = (xs) => xs[Math.floor(r() * xs.length)];
const clonar = (x) => JSON.parse(JSON.stringify(x));
const EM_SP = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
/** Instante -> parede de São Paulo "AAAA-MM-DDTHH:MM:SS" (formato aceito sem fuso). */
const parede = (ms) => { const p = Object.fromEntries(EM_SP.formatToParts(ms).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; };

function historico(clientId, corte, o) {
  const debito = o.debito; const cobrar = o.cobrar;
  return {
    version: 1, clientId, clientName: 'Cliente Teste', cutoffAt: corte, batchId: 'LOTE-1', sourceKey: o.sourceKey || `${clientId}:LOTE-1:${corte}`, approvedBy: 'Laya', approvedAt: '2026-10-31T12:00:00.000Z',
    note: 'Aprovado na conferência.', rateCents: 296, importedDebitCents: debito, importedCreditCents: o.credito, collectDebt: cobrar, postpaid: o.pos,
    items: cobrar && debito > 0 ? [{ id: 'I1', date: '01/01/2026', tarot: 'Osíris', minutes: 10, valueTodayCents: debito, allocatedCents: debito, partial: false }] : [],
    ...(o.posCredito ? { postpaidCredit: o.posCredito } : {}),
  };
}

(async () => {
  process.env.FADAS_MODE = 'real';
  const { createServer } = await import(pathToFileURL(path.join(front, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-migracao', define: { __FADAS_NODE_ARTIFACT__: 'true' }, resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error' });
  try {
    const modelo = await vite.ssrLoadModule('/features/migration/client-migration-history-model.ts');
    const migracao = await vite.ssrLoadModule('/features/migration/migration-model.ts');
    const historia = await vite.ssrLoadModule('/features/finance/account-story.ts');
    const caixa = await vite.ssrLoadModule('/features/finance/cash-ledger.ts');
    const cal = await vite.ssrLoadModule('/features/domain/operation-calendar.ts');
    if (cal.DEMO_CALENDAR.enabled) throw new Error('o calendário de demonstração está ligado: o ouro precisa do modo real');

    // 1) Conta com corte individual: o crédito (offset), o saldo da ficha e o saldo da conta, sobre os cenários reais de pagamentos e consultas.
    const contas = [];
    for (const c of gerarCenarios().filter((x) => x.tipo === 'conta')) {
      const pagamentos = clonar(c.pagamentos); const consultas = clonar(c.consultas);
      const linhas = historia.clientAccountStory(c.clientId, pagamentos, consultas, 0).rows;
      const instantes = [...new Set(linhas.map((l) => Date.parse(l.at)).filter(Number.isFinite))].sort((a, b) => a - b);
      const cortes = [parede((instantes[0] || Date.parse('2026-10-15T12:00:00Z')) - 86400000), parede((instantes[instantes.length - 1] || Date.parse('2026-10-15T12:00:00Z')) + 86400000)];
      for (const ms of instantes) { cortes.push(parede(ms)); cortes.push(parede(ms - 1000)); }
      if (instantes.length > 1) cortes.push(parede((instantes[0] + instantes[instantes.length - 1]) / 2));
      cortes.push(`${parede(instantes[0] || Date.parse('2026-10-15T12:00:00Z')).slice(0, 10)}`); // só a data
      for (const corte of [...new Set(cortes)].slice(0, 12)) {
        const debito = pick([0, 0, 12000, 3550]); const credito = pick([0, 5000, 20000]); const cobrar = pick([true, false]); const pos = pick([true, false]);
        const h = historico(c.clientId, corte, { debito, credito, cobrar, pos, posCredito: pick([undefined, { limit: 200, paymentTermDays: 7 }]) });
        const valido = modelo.validClientMigrationHistory(h);
        const caso = { clientId: c.clientId, pagamentos: c.pagamentos, consultas: c.consultas, historico: h, valido };
        if (valido) {
          const offset = modelo.migrationOpeningOffset(h, linhas);
          const historia2 = modelo.migrationCurrentStory(h, linhas);
          caso.esperado = {
            abertura: modelo.migrationOpeningCents(h), offset, saldoDaFicha: historia2.balance, aberturaDaFicha: historia2.openingBalance, linhasDepoisDoCorte: historia2.rows.length, linhasAntes: historia2.previousRows.length,
            saldoDaConta: caixa.clientCashAccount(c.clientId, pagamentos, consultas, offset).balance,
            depois: linhas.map((l) => modelo.migrationEventAfterCutoff(h, l)),
            valores: linhas.map((l) => Math.round(l.value * 100)),
          };
        }
        contas.push(caso);
      }
    }

    // 2) Validade do histórico: o válido e variações que o front aceita ou recusa.
    const base = historico('900100', '2026-10-20T12:00:00', { debito: 12000, credito: 5000, cobrar: true, pos: false });
    const mutacoes = [
      (h) => { h.version = 2; }, (h) => { h.clientId = ''; }, (h) => { h.clientName = '  '; }, (h) => { h.cutoffAt = 'ontem'; }, (h) => { h.cutoffAt = '31/02/2026'; }, (h) => { h.cutoffAt = '20/10/2026 10:30'; },
      (h) => { h.batchId = ''; }, (h) => { h.sourceKey = ''; }, (h) => { h.approvedBy = ''; }, (h) => { h.approvedAt = 'xx'; }, (h) => { h.note = ''; }, (h) => { h.rateCents = 0; }, (h) => { h.rateCents = 2.5; },
      (h) => { h.importedDebitCents = -1; }, (h) => { h.importedCreditCents = 1.5; }, (h) => { h.collectDebt = 'sim'; }, (h) => { h.postpaid = 1; }, (h) => { h.items = null; },
      (h) => { h.items[0].date = '25/12/2026'; }, (h) => { h.items[0].id = ''; }, (h) => { h.items.push({ ...h.items[0] }); }, (h) => { h.items[0].minutes = 0; }, (h) => { h.items[0].allocatedCents = 5; },
      (h) => { h.items[0].partial = true; }, (h) => { h.items[0].tarot = ''; }, (h) => { h.items[0].originalCents = -2; }, (h) => { h.collectDebt = false; }, (h) => { h.collectDebt = false; h.items = []; },
      (h) => { h.sourceDate = 5; }, (h) => { h.dateMeaning = 3; }, (h) => { h.sourceNote = {}; }, (h) => { h.postpaidCredit = { limit: -1 }; }, (h) => { h.postpaidCredit = { limit: 100, extra: 1 }; },
      (h) => { h.postpaidCredit = { paymentTermDays: 4000 }; }, (h) => { h.postpaidCredit = { limit: 10.005 }; }, (h) => { h.postpaidCredit = { limit: 150.5, paymentTermDays: 30 }; },
      (h) => { h.previousConsultations = [{ id: 'c1', date: '01/01/2026', tarot: 'Osíris', minutes: 10 }]; }, (h) => { h.previousConsultations = [{ id: 'c1', date: '25/12/2026', tarot: 'Osíris', minutes: 10 }]; },
      (h) => { h.previousConsultations = [{ id: 'c1', date: '01/01/2026', tarot: 'Osíris', minutes: -1 }]; }, (h) => { h.previousConsultations = 'x'; }, (h) => { h.example = true; },
      (h) => { h.items[0].date = '20/10/2026 12:00'; }, (h) => { h.items[0].date = '20/10/2026 12:00:01'; }, (h) => { h.cutoffAt = '2026-10-20T15:00:00Z'; h.items[0].date = '2026-10-20T12:00:00-03:00'; },
      (h) => { h.cutoffAt = '2026-10-20T15:00:00Z'; h.items[0].date = '2026-10-20T12:00:01-03:00'; }, (h) => { h.importedDebitCents = 0; h.items = []; h.collectDebt = true; }, (h) => { delete h.postpaidCredit; },
    ];
    const validade = [{ historico: base, valido: modelo.validClientMigrationHistory(base) }];
    for (const m of mutacoes) { const h = clonar(base); m(h); validade.push({ historico: h, valido: modelo.validClientMigrationHistory(h) }); }
    validade.push({ historico: null, valido: modelo.validClientMigrationHistory(null) }, { historico: 'texto', valido: modelo.validClientMigrationHistory('texto') });

    // 3) parseMigrationDate.
    const datas = ['20/10/2026', '1/2/2026', '31/02/2026', '29/02/2028', '29/02/2027', '20/10/2026 10:30', '20/10/2026 25:00', '20/10/2026 10:30:59', '20/10/2026T10:30', '2026-10-20', '2026-13-01', '2026-10-20T10:30', '2026-10-20T10:30:15', '2026-10-20T10:30:15.123', '2026-10-20T15:00:00Z', '2026-10-20T02:00:00Z',
      '2026-10-20T10:30:15-03:00', '2026-10-20T23:59:59+03:00', '2026-11-01T02:30:00Z', '2018-11-04T01:30:00-02:00', '0999-01-01', '  20/10/2026  ', '', 'abc', '2026-10-20 10:30', '2026-10-20T24:00', '20-10-2026'];
    const analise = datas.map((d) => ({ texto: d, valor: migracao.parseMigrationDate(d) }));

    // 4) Aplicação de lote: idempotência por sourceKey, conflito, superada, inválido.
    const h1 = historico('900100', '2026-10-20T12:00:00', { debito: 12000, credito: 5000, cobrar: true, pos: false, sourceKey: 'A:1' });
    const h1b = { ...clonar(h1), note: 'Nota diferente.' };
    const h2 = historico('900100', '2026-10-25T12:00:00', { debito: 0, credito: 8000, cobrar: false, pos: true, sourceKey: 'A:2' });
    const h3 = historico('900101', '2026-10-20T12:00:00', { debito: 3000, credito: 0, cobrar: false, pos: false, sourceKey: 'B:1' });
    const invalido = { ...clonar(h3), note: '' };
    const sequencias = [
      { antes: [], lote: [h1] }, { antes: [h1], lote: [h1] }, { antes: [h1], lote: [h1b] }, { antes: [h1, h2], lote: [h1] }, { antes: [h1, h2], lote: [h2] }, { antes: [h1], lote: [h2, h3] },
      { antes: [], lote: [h1, h1] }, { antes: [], lote: [h1, h2, h1] }, { antes: [], lote: [h1, h1b] }, { antes: [h1], lote: [h3, invalido] }, { antes: [], lote: [invalido] }, { antes: [h3], lote: [h1, h3] }, { antes: [], lote: [] },
    ];
    const lotes = sequencias.map((s) => {
      let loja = { version: 1, histories: {} };
      for (const h of s.antes) loja = modelo.appendClientMigrationHistories(loja, [clonar(h)]);
      const antes = clonar(loja.histories);
      let erro; let depois;
      try { depois = modelo.appendClientMigrationHistories(loja, clonar(s.lote)).histories; } catch (e) { erro = e.message; }
      return { antes, lote: s.lote, ...(erro ? { erro } : { depois: Object.fromEntries(Object.entries(depois).map(([id, rows]) => [id, rows.map((x) => x.sourceKey)])) }) };
    });

    const destino = path.join(__dirname, 'apoio-gf-migracao', 'ouro-migracao-front.json');
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, `${JSON.stringify({ gerado: 'a partir do código do front (client-migration-history-model, migration-model, account-story, cash-ledger)', contas, validade, datas: analise, lotes })}\n`);
    console.log(`${contas.length} contas (${contas.filter((c) => c.valido).length} válidas), ${validade.length} validades, ${analise.length} datas, ${lotes.length} lotes gravados em ${path.relative(process.cwd(), destino)}`);
  } finally { await vite.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
