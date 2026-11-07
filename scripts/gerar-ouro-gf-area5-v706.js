'use strict';

/**
 * Gera o OURO da área 5 da v706 (painel, consultas, financeiro, pendências e recados) a partir do CÓDIGO REAL do front, só para o que a Nice mudou e os
 * ouros antigos não cobriam: arredondamento de minutos de crédito, recibo dividido entre consultas, reserva de recibo de mais tempo, permissão de registrar
 * saídas, recados por departamento ("Sobre cliente" incluso), identidade do agendamento (cliente x contato) e datas de recibo do painel.
 *   node scripts/gerar-ouro-gf-area5-v706.js --front=<pasta do front>      (saída: scripts/apoio-gf-area5-v706/ouro-area5-v706.json; tudo fictício)
 * Usa o vite do próprio front (ssrLoadModule), sem tocar nele. Relógio travado.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const C = require('./apoio-gf-area5-v706/cenarios');
const R = require('./apoio-gf-area5-v706/cenarios-recados');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));
const limpo = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const tentar = (fn) => { try { return { ok: limpo(fn()) }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-area5', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  const dateNow = Date.now; Date.now = () => C.BASE;
  try {
    const ld = (p) => vite.ssrLoadModule(p);
    const [rd, lots, bill, tar, perm, occ, flow, fund, model, dep, note, transf] = await Promise.all(['/features/domain/credit-minute-rounding.ts', '/features/domain/credit-lots.ts', '/features/domain/consultation-billing.ts', '/features/domain/credit-tariff.ts',
      '/features/finance/outgoing-permissions.ts', '/features/finance/financial-occurrences.ts', '/features/painel/panel-flow-model.ts', '/features/agenda/agenda-launch-funding.ts', '/features/agenda/agenda-model.ts', '/features/painel/note-departments.ts', '/features/painel/operational-note-model.ts', '/features/finance/balance-transfer-model.ts'].map(ld));
    const casos = { credito: [], recibo: [], reserva: [], saida: [], recados: [], identidade: [], datas: [], transferencia: [] };

    for (let k = 0; k < 400; k += 1) { // 1) arredondamento e alocação de lotes
      const c = C.cenarioCredito();
      casos.credito.push({ ...c, esperado: { rounding: limpo(rd.creditRoundingForLots(c.lotes)), minutos: rd.creditRoundingMinutes(c.lotes, c.arred), inteiros: rd.wholeCreditMinutes(c.exato),
        alocacao: limpo((({ amount, rawAmount, roundedMinutes, uncoveredMinutes }) => ({ amount, rawAmount, roundedMinutes, uncoveredMinutes }))(lots.allocateCreditLots(c.lotes, c.pedidos, c.valor, c.arred))) } });
    }
    for (let k = 0; k < 500; k += 1) { // 2) recibo dividido: financiamento, minutos financiados, acerto e correção nominal
      const c = C.cenarioRecibo(); const alvo = c.consultas[0];
      const acerto = (it) => { const s = bill.consultationSettlement(it, c.pagamentos); return Object.fromEntries(['unitValue', 'purchased', 'funded', 'chargeable', 'debit', 'cashCredit', 'complementMinutes'].map((f) => [f, s[f]])); };
      const depois = c.pagamentos.map((p) => (C.chance(0.5) && !p.linkedConsultationId && p.amount > 5 ? { ...p, amount: C.centavos(p.amount * C.pick([0.5, 0.8, 1.2, 1.5])) } : p));
      const aud = { actor: 'Equipe', at: '2026-10-12T15:00:00.000Z', commandId: 'cmd-1' };
      casos.recibo.push({ ...c, depois, aud, esperado: { funding: limpo(bill.consultationFunding(alvo, c.pagamentos)), minutos: tentar(() => bill.fundedMinutesForConsultation(alvo, c.pagamentos)), acerto: tentar(() => acerto(alvo)),
        valores: c.pagamentos.map((p) => limpo(bill.consultationFunding(alvo, [p]).map((l) => bill.consultationFundingValue(l, p)))), reconciliado: tentar(() => bill.reconcileConsultationFundingPayments(c.consultas, c.pagamentos, depois, aud)) } });
    }
    for (let k = 0; k < 300; k += 1) { // 3) saldo de crédito com recibo separado para mais tempo
      const c = C.cenarioReserva(); const em = new Date(C.BASE).toISOString();
      const reservar = C.chance(0.7);
      const t = tar.clientCreditTariff('c1', em, undefined, c.consultas, c.pagamentos, c.perfil || undefined, undefined, reservar);
      casos.reserva.push({ ...c, em, reservar, esperado: limpo({ availableMinutes: t.availableMinutes, exactAvailableMinutes: t.exactAvailableMinutes, availableAmount: t.availableAmount, unitValue: t.unitValue, creditRounding: t.creditRounding, paymentIds: t.paymentIds, lots: t.availableLots.map((l) => [l.paymentId, l.cents, l.minutes]) }) });
    }
    // 4) quem registra saída: matriz papel x conta, e o registro de uma ocorrência simples
    for (const papel of C.PAPEIS) for (const variante of ['sem-conta', 'permissao', 'sem-permissao', 'inativa', 'outro-papel', 'conta-sem-flag']) for (const decisao of ['pending', 'maintain', 'waive']) {
      const conta = variante === 'sem-conta' ? undefined : C.contaDe(variante === 'outro-papel' ? 'tarologa' : papel, { active: variante !== 'inativa', ...(variante === 'permissao' ? { financialPermissions: { registerOutgoing: true } } : variante === 'sem-permissao' ? { financialPermissions: { registerOutgoing: false } } : {}) });
      const pg = C.pagamento('pg0', 'c1', 100, { updatedAt: '2026-10-12T14:00:00.000Z' });
      const estado = { payments: [pg], consultations: [] };
      const entrada = { operationId: 'op-123', id: 'oc-123', paymentId: 'pg0', kind: 'payment-missing', initiatedBy: 'company', agreement: 'pending', chargeDecision: decisao, amount: 20, note: 'Conferido com o banco.', bankMoved: false, expectedPaymentVersion: occ.financialPaymentVersion(pg) };
      const em = '2026-10-12T15:00:00.000Z';
      casos.saida.push({ papel, conta: conta || null, estado, entrada, em, esperado: { pode: perm.canRegisterPaymentOutgoing(papel, conta), registro: tentar(() => occ.recordFinancialOccurrence(estado, entrada, 'Assist', papel, em, conta).payments) } });
    }
    R.gerarRecados(casos, { dep, note, limpo, tentar });
    R.gerarIdentidade(casos, { flow, fund, model, limpo, tentar });
    R.gerarDatas(casos, { flow, limpo, tentar });
    R.gerarTransferencia(casos, { transf, limpo, tentar });

    const saida = path.join(__dirname, 'apoio-gf-area5-v706', 'ouro-area5-v706.json');
    fs.writeFileSync(saida, `${JSON.stringify({ geradoDe: 'credit-minute-rounding, credit-lots, consultation-billing, credit-tariff, outgoing-permissions, financial-occurrences, note-departments, operational-note-model, panel-flow-model, agenda-launch-funding, agenda-model do front v706', base: C.BASE, casos })}\n`);
    console.log(`OK: ${Object.entries(casos).map(([n, l]) => `${n}=${l.length}`).join(' ')} -> ${path.relative(process.cwd(), saida)}`);
  } finally { Date.now = dateNow; await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
