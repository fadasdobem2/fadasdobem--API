'use strict';

/**
 * Gera o ouro financeiro (scripts/apoio-gf-financeiro/ouro-financeiro-front.json) A PARTIR DO CÓDIGO REAL DO FRONT: `consultationSettlement`
 * (domain/consultation-billing.ts), `clientCashAccount` (finance/cash-ledger.ts), `clientCreditTariff` (domain/credit-tariff.ts),
 * `clientFundingCoverage` (finance/client-payment-state.ts), `assessTarologistFinish` (tarologas/tarologist-finish-assessment.ts), mais as
 * funções de preço (domain/pricing.ts, domain/financial-settings.ts) e de restrição (restricoes/restriction-model.ts), com os cenários de
 * scripts/apoio-gf-financeiro/cenarios.js e precos-restricoes.js. Uso (o FRONT tem de ter node_modules; nada nele é alterado):
 *   node scripts/gerar-ouro-gf-financeiro.js --front=<pasta do FRONT>
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { gerarCenarios } = require('./apoio-gf-financeiro/cenarios');
const { gerarCenariosPrecosRestricoes } = require('./apoio-gf-financeiro/precos-restricoes');
const { RESUMO } = require('./apoio-gf-financeiro/resumos');

const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const front = path.resolve(arg('front') || '');
if (!arg('front') || !fs.existsSync(path.join(front, 'node_modules', 'vite'))) { console.error('Informe --front=<pasta do FRONT com node_modules>.'); process.exit(2); }

(async () => {
  process.env.FADAS_MODE = 'real';
  const { createServer } = await import(pathToFileURL(path.join(front, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
  const vite = await createServer({ root: front, appType: 'custom', configFile: false, define: { __FADAS_NODE_ARTIFACT__: 'true' }, resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error' });
  const cal = await vite.ssrLoadModule('/features/domain/operation-calendar.ts');
  if (cal.DEMO_CALENDAR.enabled) throw new Error('o calendário de demonstração está ligado: o ouro precisa do modo real');
  const fr = {
    cobranca: await vite.ssrLoadModule('/features/domain/consultation-billing.ts'),
    caixa: await vite.ssrLoadModule('/features/finance/cash-ledger.ts'),
    tarifa: await vite.ssrLoadModule('/features/domain/credit-tariff.ts'),
    cobertura: await vite.ssrLoadModule('/features/finance/client-payment-state.ts'),
    termino: await vite.ssrLoadModule('/features/tarologas/tarologist-finish-assessment.ts'),
    precos: await vite.ssrLoadModule('/features/domain/pricing.ts'),
    ajustes: await vite.ssrLoadModule('/features/domain/financial-settings.ts'),
    restricao: await vite.ssrLoadModule('/features/restricoes/restriction-model.ts'),
  };
  const saida = [];
  for (const c of [...gerarCenarios(), ...gerarCenariosPrecosRestricoes()]) {
    let esperado;
    try { esperado = RESUMO[c.tipo](fr, c); } catch (e) { esperado = { erro: e.message }; }
    saida.push({ caso: c, esperado: JSON.parse(JSON.stringify(esperado === undefined ? null : esperado)) });
  }
  await vite.close();
  const destino = path.join(__dirname, 'apoio-gf-financeiro', 'ouro-financeiro-front.json');
  fs.writeFileSync(destino, `${JSON.stringify({ gerado: 'a partir do código do front (consultation-billing, cash-ledger, credit-tariff, client-payment-state, tarologist-finish-assessment, pricing, financial-settings, restriction-model)', cenarios: saida })}\n`);
  console.log(`${saida.length} cenários gravados em ${path.relative(process.cwd(), destino)} (${saida.filter((s) => s.esperado && s.esperado.erro).length} com recusa do front)`);
})().catch((e) => { console.error(e); process.exit(2); });
