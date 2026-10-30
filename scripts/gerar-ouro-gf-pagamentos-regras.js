'use strict';

/**
 * Gera os CASOS DE OURO das regras de Pagamentos no servidor (Maturacao/41) a partir do CÓDIGO REAL do front:
 *   - `features/finance/payment-records.ts` (`createPaymentRecord`, `correctPaymentRecord`, `paymentInputFromRecord`);
 *   - `features/finance/payment-manual-review.ts` (`applyPaymentReviewBatch`, `confirmInformedPayment`: papel que confirma);
 *   - `features/finance/payment-spreadsheet-correction.ts` (`correctSpreadsheetPayment`: confirmação, cliente e taxa por papel).
 * Grava entradas, o registro que o front devolve (ou a frase da recusa) em scripts/apoio-gf-pagamentos-regras/ouro-pagamentos-regras-front.json.
 *   node scripts/gerar-ouro-gf-pagamentos-regras.js --front=<pasta do front>
 * Usa o vite do próprio front (ssrLoadModule) com o calendário real, sem tocar nele. Todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const { entradasNovo, BASES, MOVIMENTOS, MUDANCAS, PAPEIS, ID_CLIENTE, CLIENTE } = require('./apoio-gf-pagamentos-regras/cenarios');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));
const AGORA = '2026-10-30T15:00:00.000Z';
const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
const numero = (t) => Number(`${t}`.replace(/R\$/gi, '').replace(/\s/g, '').replace(',', '.'));

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-pagamentos', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const pr = await vite.ssrLoadModule('/features/finance/payment-records.ts');
    const rv = await vite.ssrLoadModule('/features/finance/payment-manual-review.ts');
    const sp = await vite.ssrLoadModule('/features/finance/payment-spreadsheet-correction.ts');
    const pricing = (await vite.ssrLoadModule('/features/domain/pricing.ts')).defaultFinancialSettings;
    const cenarios = [];
    const criar = (entrada) => tentar(() => pr.createPaymentRecord(entrada, { clientId: ID_CLIENTE, client: CLIENTE }, 'Clara', AGORA, 'PG-OURO-1', undefined, pricing));

    // 1) Lançamento novo: o registro que o front devolve, ou o registro que o navegador montaria sem a conferência.
    for (const entrada of entradasNovo(900)) {
      const r = criar(entrada);
      if (r.ok) { cenarios.push({ tipo: 'novo', entrada, record: r.ok, esperado: { ok: true } }); continue; }
      const valor = numero(entrada.amount);
      if (!Number.isFinite(valor) || valor <= 0) continue;
      const cartao = entrada.method === 'Cartão de crédito';
      const bruto = cartao ? (entrada.grossAmount === undefined || entrada.grossAmount === '' ? valor : numero(entrada.grossAmount)) : valor;
      if (!Number.isFinite(bruto)) continue;
      const naive = {
        id: 'PG-OURO-1', clientId: ID_CLIENTE, client: CLIENTE, amount: valor, grossAmount: bruto, method: entrada.method, bank: entrada.method === 'Dinheiro' ? 'Caixa' : entrada.bank,
        payerName: entrada.payerName, authorization: entrada.authorization, note: entrada.note, paidAt: entrada.paidAt || AGORA, status: 'Informado',
        ...(entrada.purchase && entrada.purchase.table === 'first' ? { purchase: entrada.purchase } : entrada.cashUnitValue ? { cashUnitValue: entrada.cashUnitValue } : entrada.purchase ? { purchase: entrada.purchase } : { cashUnitValue: 2.96 }),
      };
      cenarios.push({ tipo: 'novo', entrada, record: naive, esperado: { erro: r.erro } });
    }

    // 2) Revisão: correção do front sobre cada base x movimentos x mudança.
    const bases = BASES.map((b) => ({ chave: b.chave, pagamento: criar(b.entrada).ok }));
    for (const { chave, pagamento } of bases) {
      for (const [im, movimentos] of MOVIMENTOS.entries()) for (const cancelado of [false, true]) {
        if (cancelado && im > 1) continue;
        const antes = { ...pagamento, ...(movimentos.length ? { movements: movimentos } : {}), ...(cancelado ? { status: 'Cancelado' } : {}) };
        for (const mud of MUDANCAS) {
          const entrada = { ...pr.paymentInputFromRecord(antes), ...mud };
          const r = tentar(() => pr.correctPaymentRecord(antes, entrada, 'Clara', AGORA, pricing));
          if (r.ok) { cenarios.push({ tipo: 'revisao', base: chave, mov: im, antes, depois: r.ok, perfil: 'atendente', esperado: { ok: true } }); continue; }
          const valor = numero(entrada.amount);
          const cartao = entrada.method === 'Cartão de crédito';
          const bruto = cartao ? numero(entrada.grossAmount) : valor;
          if (!Number.isFinite(valor) || valor <= 0 || !Number.isFinite(bruto)) continue;
          const depois = { ...antes, amount: valor, grossAmount: bruto, method: entrada.method, bank: entrada.method === 'Dinheiro' ? 'Caixa' : entrada.bank, paidAt: entrada.paidAt || antes.paidAt, payerName: entrada.payerName, authorization: entrada.authorization, note: entrada.note, ...(mud.purchase ? { purchase: mud.purchase, cashUnitValue: undefined } : antes.purchase && antes.purchase.table === 'first' && entrada.method !== 'PIX' ? { purchase: undefined, cashUnitValue: 2.96 } : {}) };
          cenarios.push({ tipo: 'revisao', base: chave, mov: im, antes, depois, perfil: 'atendente', esperado: { erro: r.erro } });
        }
      }
    }

    // 3) Quem confirma o recebimento (lote da conferência) e quem usa a planilha (confirmação, cliente, taxa), por papel.
    const clientes = { '999': 'Beta Lima', [ID_CLIENTE]: CLIENTE };
    for (const { chave, pagamento } of bases) {
      const informado = pagamento;
      const confirmado = { ...pagamento, confirmation: 'Confirmado' };
      const comMov = { ...confirmado, movements: [MOVIMENTOS[1][0]] };
      const vinculado = { ...pagamento, linkedConsultationId: 'C-1' };
      for (const papel of PAPEIS) {
        const cmd = rv.preparePaymentReviewBatch([informado], new Set(), { start: '2026-10-01', end: '2026-10-31', dateBasis: 'payment', bank: 'todos', query: '', filter: 'todos' }, 'lote-1', AGORA);
        const lote = tentar(() => rv.applyPaymentReviewBatch({ payments: [informado], receipts: [], command: cmd, actor: 'Clara', role: papel, at: AGORA }).payments[0]);
        cenarios.push({ tipo: 'confirmacao', via: 'lote', base: chave, papel, antes: informado, depois: lote.ok || rv.confirmInformedPayment(informado, 'Clara', AGORA), esperado: lote.ok ? { ok: true } : { erro: lote.erro } });
        const casos = [
          ['confirmation', 'Confirmado', informado], ['confirmation', 'A confirmar', confirmado], ['confirmation', 'A confirmar', comMov], ['clientId', '999', informado], ['clientId', '999', comMov], ['clientId', '999', vinculado],
          ['actualFee', '3,00', informado], ['actualFee', '0,00', informado], ['actualFee', '500,00', informado],
        ];
        for (const [campo, valor, antes] of casos) {
          const r = tentar(() => sp.correctSpreadsheetPayment({ payments: [antes], consultations: [], role: papel, paymentId: antes.id, field: campo, value: valor, actor: 'Clara', now: AGORA, pricing, clients: clientes }));
          const naive = campo === 'confirmation' ? { ...antes, confirmation: valor } : campo === 'clientId' ? { ...antes, clientId: valor, client: clientes[valor] } : { ...antes, actualFee: numero(valor) };
          const depois = r.ok && r.ok !== antes ? r.ok : naive;
          if (r.ok === antes) continue;
          cenarios.push({ tipo: 'planilha', base: chave, papel, campo, valor, antes, depois, esperado: r.ok ? { ok: true } : { erro: r.erro } });
        }
      }
    }
    const saida = path.join(__dirname, 'apoio-gf-pagamentos-regras', 'ouro-pagamentos-regras-front.json');
    fs.writeFileSync(saida, JSON.stringify({ geradoDe: 'features/finance/payment-records.ts, payment-manual-review.ts, payment-spreadsheet-correction.ts', agora: AGORA, cenarios }));
    const por = {}; for (const c of cenarios) por[c.tipo] = (por[c.tipo] || 0) + 1;
    console.log(`Ouro gravado: ${cenarios.length} cenários (${Object.entries(por).map(([k, v]) => `${k}=${v}`).join(' ')}); recusas do front: ${cenarios.filter((c) => c.esperado.erro).length}.`);
  } finally { await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
