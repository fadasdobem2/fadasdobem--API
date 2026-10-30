'use strict';

/**
 * OURO da cobertura financeira do cartão e do passo de reserva (Maturacao/39), do CÓDIGO REAL do front com `Date.now` travado:
 * `panelReservationStep` (panel-flow-model.ts), `agendaLaunchFunding` (agenda-launch-funding.ts), `agendaFundingState` (agenda-model.ts),
 * `queueLaunchBalance`, `readerContinuationOffer` e `money` (formatters.ts). Grava scripts/apoio-gf-painel/ouro-painel-lancamento.json.
 *   node scripts/gerar-ouro-gf-painel-lancamento.js --front=<pasta do front>
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));

let semente = 20261126;
const aleatorio = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
const sorteio = (l) => l[Math.floor(aleatorio() * l.length)];
const chance = (p) => aleatorio() < p;
const inteiro = (n) => Math.floor(aleatorio() * n);
const AGORAS = ['2026-10-12T10:00:00-03:00', '2026-10-12T05:50:00-03:00', '2026-10-12T06:05:00-03:00', '2026-10-13T00:30:00-03:00', '2026-10-12T14:20:00-03:00'].map(Date.parse);
const iso = (ms) => new Date(ms).toISOString();
const diaOp = (ms) => new Date(ms - 9 * 3600000).toISOString().slice(0, 10);
const relogio = (ms) => new Date(ms - 3 * 3600000).toISOString().slice(11, 16);

function item(agora, dia, clientId) {
  const it = { id: 'ag1', clientId, client: 'Cliente', tarotId: sorteio(['afila', 'afila', 'r1']), date: dia, time: '09:00', createdAt: iso(agora - 600000 * (1 + inteiro(30))), position: 1, response: 'Aguardando resposta', contact: { attempt: 1, date: dia, tags: [] }, contactHistory: [] };
  if (chance(0.6)) { const tags = sorteio([['Avisada'], ['Pode agora'], ['Avisada', 'Pode agora'], ['Vai pagar'], ['Chama depois'], ['Não respondeu']]); it.contact = { attempt: 1, date: dia, tags }; it.contactHistory = tags.map((t, i) => ({ id: `e${i}`, actor: 'x', at: iso(agora - 1000000 + i * 1000), date: dia, attempt: 1, tag: t, active: chance(0.9), before: [], after: tags })); }
  if (chance(0.3)) it.scheduledTime = relogio(agora + sorteio([-60, -1, 0, 5, 30, 120]) * 60000);
  if (chance(0.2)) it.queueReservation = { tarotId: 'r1', at: iso(agora - 60000), by: 'Equipe' };
  if (chance(0.3)) it.paymentExpectedAmount = sorteio([44.4, 88.8, 35, 0, 120]);
  if (chance(0.2)) it.paymentPending = true;
  if (chance(0.15)) it.contactPlan = sorteio([{ who: 'client', timing: 'none' }, { who: 'staff', timing: 'after', time: relogio(agora + 600000) }]);
  if (chance(0.25)) it.continuationRequest = { sourceConsultationId: 'k1', requestedAt: iso(agora - 3600000), requestedBy: 'x' };
  if (chance(0.1)) it.agendaOutcome = 'Cancelada';
  return it;
}

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-painel-lanc', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  const dateNow = Date.now;
  try {
    const fl = await vite.ssrLoadModule('/features/painel/panel-flow-model.ts');
    const fu = await vite.ssrLoadModule('/features/agenda/agenda-launch-funding.ts');
    const fm = await vite.ssrLoadModule('/features/domain/formatters.ts');
    const tentar = (fn) => { try { return { ok: JSON.parse(JSON.stringify(fn())) }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
    const casos = []; let pulados = 0; const tipos = {};
    for (let k = 0; k < 500; k += 1) {
      const agora = sorteio(AGORAS) + inteiro(30) * 60000; const dia = diaOp(agora); Date.now = () => agora;
      const clientId = 'c1'; const it = item(agora, dia, clientId);
      const pagamentos = Array.from({ length: inteiro(4) }, (_, i) => ({ id: `p${i}`, clientId: chance(0.9) ? clientId : 'c2', client: 'C', amount: sorteio([44.4, 88.8, 35, 59.2, 100.5, 10, 120, 20]), status: sorteio(['Informado', 'Informado', 'Corrigido', 'Cancelado']), method: sorteio(['PIX', 'Dinheiro']),
        paidAt: sorteio([iso(agora - 3600000 * (1 + inteiro(40))), diaOp(agora)]), informedAt: iso(agora - 3600000), movements: chance(0.2) ? [{ id: `m${i}`, kind: 'refund', amount: 10, creditEffect: -10, bankEffect: -10, occurredAt: iso(agora - 1000) }] : [], audit: [],
        ...(chance(0.3) ? { confirmation: sorteio(['Confirmado', 'Aguardando']) } : {}), ...(chance(0.2) ? { purchase: { minutes: 15, amount: 44.4, table: 'regular' } } : {}), ...(chance(0.15) ? { cashUnitValue: 2.96 } : {}), ...(chance(0.2) ? { linkedConsultationId: 'k1' } : {}) }));
      const consultations = Array.from({ length: inteiro(4) }, (_, i) => ({ id: `k${i + 1}`, clientId: chance(0.8) ? clientId : 'c2', tarotId: sorteio(['r1', 'r2']), tarot: 'L', client: 'C', status: sorteio(['Em curso', 'Concluída', 'Finalizada pelo tarólogo', 'Cancelada', 'Devolvida']), startedAt: iso(agora - 3600000 * (1 + inteiro(30))), durationSeconds: sorteio([0, 600, 1200, 1800]), audit: [],
        ...(chance(0.3) ? { agendaItemId: 'ag1' } : {}), ...(chance(0.15) ? { tarologistFinishReport: { submittedAt: iso(agora - 60000), minutes: 10 } } : {}), ...(chance(0.25) ? { coverage: { kind: 'Crédito', minutes: 15, balanceAtLaunch: 44.4 } } : {}), ...(chance(0.15) ? { billing: { minimumMinutes: 15, funding: [{ paymentId: 'p0', cents: 4440 }] } } : {}),
        ...(chance(0.2) ? { tarologistMoreTimeRequest: { active: true, requestedAt: iso(agora - 100000), reporterName: 'L' } } : {}), ...(chance(0.1) ? { awaitingTarologistStart: true } : {}), ...(chance(0.1) ? { bonusGrant: { minutes: 15, grantedBy: 'x', grantedAt: iso(agora - 86400000) } } : {}) }));
      const perfil = chance(0.8) ? { id: clientId, name: 'Cliente', credit: sorteio([0, 0, 20, 44.4, -10]), movements: [], ...(chance(0.25) ? { paymentProfile: sorteio(['Pós-pago', 'Pré-pago']) } : {}), ...(chance(0.2) ? { minuteBenefits: [{ id: 'b1', clientId, kind: 'Bônus', minutes: sorteio([5, 15]), unitValue: 2.96, reason: 'x', grantedBy: 'x', grantedAt: iso(agora - 86400000) }] } : {}) } : undefined;
      const intakeEvents = chance(0.25) ? [{ id: 'ev1', tarotId: sorteio(['r1', 'afila']), date: dia, mode: sorteio(['open', 'no_more', 'until_end']), at: iso(agora - 60000), by: 'x', consultationIds: [], closeScope: sorteio(['shift', 'day']), closedUntil: iso(agora + 3600000), endTime: '23:00', agendaIds: [] }] : [];
      const pricing = chance(0.2) ? { id: 'V', regularMinuteValue: 3, minimumMinutes: sorteio([10, 15, 30]), regularPrices: [{ minutes: 15, price: 45 }], firstConsultationPrices: [] } : undefined;
      const entrada = { payments: pagamentos, consultations, date: dia, now: agora, intakeEvents, pricing: pricing || null };
      const passo = tentar(() => fl.panelReservationStep(it, { ...entrada, pricing }, perfil));
      if (passo.erro) { pulados += 1; continue; }
      const fin = tentar(() => { const f = fu.agendaLaunchFunding(it, { payments: pagamentos, consultations, now: agora, pricing }, perfil); const { coverage, ...resto } = f; return { ...resto, coverage: { balance: coverage.balance, postpaid: coverage.postpaid, benefitMinutes: coverage.benefitMinutes, hasConfirmedReceipt: coverage.hasConfirmedReceipt, confirmedAvailableBalance: coverage.confirmedAvailableBalance, awaitingConfirmation: coverage.awaitingConfirmation, canConsult: coverage.canConsult, canLaunch: coverage.canLaunch, label: coverage.label } }; });
      tipos[passo.ok.kind] = (tipos[passo.ok.kind] || 0) + 1;
      casos.push({ item: it, perfil: perfil || null, entrada: JSON.parse(JSON.stringify(entrada)), passo: passo.ok, financiamento: fin });
    }
    const valores = [0, 0.004, 0.005, 0.01, 1, 9.99, 10.005, 44.4, 999.99, 1000, 1234.56, 12345.678, -10, -0.004, -1234.5, 1e6, 0.1 + 0.2, 2.675, 1.005];
    for (let i = 0; i < 200; i += 1) valores.push(Math.round(aleatorio() * 1e7) / 100 * (chance(0.1) ? -1 : 1), aleatorio() * 5000);
    Date.now = dateNow;
    const saida = path.join(__dirname, 'apoio-gf-painel', 'ouro-painel-lancamento.json');
    fs.writeFileSync(saida, `${JSON.stringify({ geradoDe: 'panel-flow-model.ts (panelReservationStep), agenda-launch-funding.ts, agenda-model.ts, queue-launch-balance.ts, reader-continuation-start.ts, formatters.ts (money) do front, com Date.now travado por caso', casos, moeda: valores.map((v) => [v, fm.money.format(v)]) })}\n`);
    console.log(`OK: ${casos.length} casos (pulados ${pulados}), passos ${JSON.stringify(tipos)}, ${valores.length} valores de moeda -> ${path.relative(process.cwd(), saida)}`);
  } finally { Date.now = dateNow; await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
