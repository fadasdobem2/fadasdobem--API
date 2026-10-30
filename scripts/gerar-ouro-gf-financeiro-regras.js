'use strict';

/**
 * Gera os CASOS DE OURO das regras financeiras de pagamento no servidor (Maturacao/42) a partir do CÓDIGO REAL do front: movimento
 * (`cash-ledger.ts`, `payment-credit-refund.ts`, `payment-movement-correction.ts`), ocorrências (`financial-occurrences.ts`), transferência de saldo,
 * planilha, compra e duplicidade, datas de migração. Uma área por arquivo `scripts/apoio-gf-financeiro-regras/ouro-<area>-front.json`.
 *   node scripts/gerar-ouro-gf-financeiro-regras.js --front=<pasta do front> [--so=movimento,ocorrencias,...]
 * Usa o vite do próprio front (ssrLoadModule) com o calendário real, sem tocar nele. Todo valor é fictício; o relógio é fixo.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));
const AREAS = ['movimento', 'ocorrencias', 'transferencia', 'planilha', 'compra', 'datas', 'duplicidade'];
const so = arg('so') ? arg('so').split(',') : AREAS;

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-fin-regras', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const carregar = (m) => vite.ssrLoadModule(m);
    const fr = {
      registros: await carregar('/features/finance/payment-records.ts'), precos: await carregar('/features/domain/pricing.ts'), livro: await carregar('/features/finance/cash-ledger.ts'),
      credito: await carregar('/features/finance/payment-credit-refund.ts'), correcao: await carregar('/features/finance/payment-movement-correction.ts'),
      ocorrencias: await carregar('/features/finance/financial-occurrences.ts'), transferencia: await carregar('/features/finance/balance-transfer-model.ts'),
      planilha: await carregar('/features/finance/payment-spreadsheet-correction.ts'), referencia: await carregar('/features/finance/payment-pricing-reference.ts'),
      duplicidade: await carregar('/features/finance/payment-duplicate-model.ts'), reconciliacao: await carregar('/features/finance/consultation-payment-reconciliation-model.ts'),
      cobranca: await carregar('/features/domain/consultation-billing.ts'),
    };
    const cal = await carregar('/features/domain/operation-calendar.ts');
    if (cal.DEMO_CALENDAR.enabled) throw new Error('o calendário de demonstração está ligado: o ouro precisa do modo real');
    for (const area of so) {
      if (!AREAS.includes(area)) throw new Error(`área desconhecida: ${area}`);
      const arquivo = path.join(__dirname, 'apoio-gf-financeiro-regras', `gerar-${area}.js`);
      if (!fs.existsSync(arquivo)) { console.log(`${area}: gerador ainda não existe, ignorado`); continue; }
      const cenarios = require(arquivo).gerar(fr);
      const saida = path.join(__dirname, 'apoio-gf-financeiro-regras', `ouro-${area}-front.json`);
      fs.writeFileSync(saida, JSON.stringify({ area, geradoDe: 'features/finance/*.ts (código real do front)', cenarios }));
      const por = {}; for (const c of cenarios) por[c.tipo] = (por[c.tipo] || 0) + 1;
      console.log(`${area}: ${cenarios.length} cenários (${Object.entries(por).map(([k, v]) => `${k}=${v}`).join(' ')}); recusas do front: ${cenarios.filter((c) => c.esperado && c.esperado.erro).length}.`);
    }
  } finally { await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
