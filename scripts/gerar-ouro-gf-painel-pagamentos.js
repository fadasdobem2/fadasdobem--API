'use strict';

/**
 * OURO dos pagamentos sem agenda e do acompanhamento de pagamento (Maturacao/39), do CÓDIGO REAL do front com `Date.now` travado:
 * `unassignedPayments` (panel-flow-model.ts), `markUnassignedPaymentsAsked` e `resumeUnassignedPayments` (payment-service-follow-up.ts).
 *   node scripts/gerar-ouro-gf-painel-pagamentos.js --front=<pasta do front>
 * Grava scripts/apoio-gf-painel/ouro-painel-pagamentos.json. Todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));

let semente = 20261125;
const aleatorio = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
const sorteio = (l) => l[Math.floor(aleatorio() * l.length)];
const chance = (p) => aleatorio() < p;
const inteiro = (n) => Math.floor(aleatorio() * n);
const AGORAS = ['2026-10-12T10:00:00-03:00', '2026-10-12T05:50:00-03:00', '2026-10-12T06:05:00-03:00', '2026-10-13T00:30:00-03:00', '2026-10-12T23:55:00-03:00'].map(Date.parse);
const iso = (ms) => new Date(ms).toISOString();
const diaOp = (ms) => new Date(ms - 9 * 3600000).toISOString().slice(0, 10);
const somar = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function pagamento(i, clientId, agora, dia) {
  const em = agora - inteiro(60) * 3600000 * (chance(0.7) ? 1 : 0.2) - inteiro(30) * 60000;
  const p = { id: `p${i}`, clientId, client: `Cliente ${clientId}`, amount: sorteio([44.4, 88.8, 35, 59.2, 100.5, 10, 159.9, 120, 43, 42.2, 45, 44.39]), status: sorteio(['Informado', 'Informado', 'Corrigido', 'Cancelado']), method: sorteio(['PIX', 'Dinheiro', 'Cartão']),
    paidAt: sorteio([iso(em), iso(em), iso(em), diaOp(em), somar(diaOp(em), -1), 'texto-invalido']), informedAt: iso(em), movements: [], audit: [] };
  if (chance(0.3)) p.confirmation = sorteio(['Confirmado', 'Confirmado', 'Aguardando']);
  if (chance(0.25)) p.purchase = { minutes: sorteio([15, 20, 30]), amount: p.amount, table: sorteio(['regular', 'first']) };
  if (chance(0.15)) p.cashUnitValue = sorteio([2.96, 2.5, 3.1]);
  if (chance(0.2)) p.movements = [{ id: `m${i}`, kind: sorteio(['refund', 'adjustment']), amount: 10, creditEffect: sorteio([-10, -5, 5]), bankEffect: 0, occurredAt: iso(em + 60000) }];
  if (chance(0.3)) {
    const evs = [{ id: `e${i}a`, action: 'asked', at: iso(agora - inteiro(300) * 60000 + (chance(0.1) ? 7200000 : 0)), actor: 'Equipe', reason: 'x' }];
    if (chance(0.4)) evs.push({ id: `e${i}b`, action: 'later', reviewOn: somar(dia, sorteio([-1, 0, 1, 3])), at: iso(agora - 60000), actor: 'Equipe', reason: 'x' });
    if (chance(0.2)) evs.push({ action: 'resume', at: iso(agora - 30000), actor: 'Equipe', reason: 'x' });
    p.serviceFollowUp = { events: evs };
  }
  if (chance(0.1)) delete p.paidAt;
  return p;
}

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-painel-pag', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  const dateNow = Date.now;
  try {
    const fl = await vite.ssrLoadModule('/features/painel/panel-flow-model.ts');
    const fu = await vite.ssrLoadModule('/features/painel/payment-service-follow-up.ts');
    const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
    let contador = 0; Object.defineProperty(globalThis.crypto, 'randomUUID', { value: () => `id-${++contador}`, configurable: true });
    const casos = []; let pulados = 0; const est = { semAgenda: 0, mutaveis: 0, recusas: 0 };
    for (let k = 0; k < 400; k += 1) {
      const agora = sorteio(AGORAS) + (chance(0.5) ? inteiro(30) * 60000 : 0); const dia = diaOp(agora); Date.now = () => agora;
      const clientes = ['c1', 'c2', 'c3', 'c4'].slice(0, 2 + inteiro(3));
      const pagamentos = Array.from({ length: 2 + inteiro(7) }, (_, i) => pagamento(i, sorteio(clientes), agora, dia));
      const agenda = chance(0.4) ? [{ id: 'ag1', clientId: sorteio(clientes), tarotId: 'afila', date: dia, contact: { attempt: 1, date: dia, tags: [] }, position: 1, time: '09:00', createdAt: iso(agora), contactHistory: [], ...(chance(0.3) ? { agendaOutcome: 'Cancelada' } : {}) }] : [];
      const consultations = Array.from({ length: inteiro(4) }, (_, i) => ({ id: `k${i}`, clientId: sorteio(clientes), tarotId: 'r1', tarot: 'L', client: 'C', status: sorteio(['Em curso', 'Concluída', 'Finalizada pelo tarólogo', 'Cancelada', 'Devolvida']), startedAt: iso(agora - 3600000 * (1 + inteiro(40))), durationSeconds: sorteio([0, 600, 1200]), audit: [],
        ...(chance(0.2) ? { tarologistFinishReport: { submittedAt: iso(agora - 60000), minutes: 10 } } : {}), ...(chance(0.3) ? { linkedPaymentId: 'p0' } : {}), ...(chance(0.3) ? { coverage: { kind: 'Crédito', minutes: 15, balanceAtLaunch: 44.4 } } : {}) }));
      const perfis = Object.fromEntries(clientes.filter(() => chance(0.7)).map((c) => [c, { id: c, name: `Nome ${c}`, credit: sorteio([0, 0, 20, 44.4, -10]), movements: chance(0.8) ? [] : [{ kind: 'consulta' }], ...(chance(0.2) ? { hasPriorConsultations: true } : {}), ...(chance(0.15) ? { firstConsultationAt: iso(agora - 86400000) } : {}) }]));
      const cadastros = Object.fromEntries(clientes.map((c) => [c, { createdAt: sorteio([iso(agora - 86400000), iso(agora - 9 * 86400000), undefined, iso(agora + 60000), iso(agora - 7 * 86400000), iso(agora - 7 * 86400000 - 1), iso(agora - 7 * 86400000 + 1), iso(agora)]) }]));
      const preco = chance(0.15) ? { id: 'V2', regularMinuteValue: sorteio([3, 2.5]), minimumMinutes: sorteio([10, 20]), regularPrices: [{ minutes: 15, price: 40 }], firstConsultationPrices: [{ minutes: 15, price: 30 }] } : undefined;
      const entrada = { pagamentos, consultations, agenda, perfis, cadastros, data: dia, agora, preco: preco || null };
      const r = tentar(() => fl.unassignedPayments(pagamentos, consultations, agenda, perfis, cadastros, dia, agora, preco));
      if (r.erro) { pulados += 1; continue; }
      const caso = { entrada: JSON.parse(JSON.stringify(entrada)), semAgenda: JSON.parse(JSON.stringify(r.ok)) };
      est.semAgenda += r.ok.length;
      caso.contatos = pagamentos.map((p) => { const c = fu.paymentContactState(p, dia, agora); return JSON.parse(JSON.stringify(c)); });
      caso.acoes = [];
      for (const acao of ['asked', 'resume']) for (let v = 0; v < 2; v += 1) {
        const ids = chance(0.85) ? pagamentos.filter(() => chance(0.6)).map((p) => p.id) : ['inexistente']; const ator = chance(0.9) ? 'Equipe' : '  ';
        contador = 0; const res = tentar(() => (acao === 'asked' ? fu.markUnassignedPaymentsAsked : fu.resumeUnassignedPayments)(pagamentos, ids, ator, agora));
        caso.acoes.push({ acao, ids, ator, res: res.ok ? { ok: JSON.parse(JSON.stringify(res.ok)) } : res }); if (res.ok && JSON.stringify(res.ok) !== JSON.stringify(pagamentos)) est.mutaveis += 1; else est.recusas += 1;
      }
      casos.push(caso);
    }
    Date.now = dateNow;
    const saida = path.join(__dirname, 'apoio-gf-painel', 'ouro-painel-pagamentos.json');
    fs.writeFileSync(saida, `${JSON.stringify({ geradoDe: 'panel-flow-model.ts (unassignedPayments), payment-service-follow-up.ts do front, com Date.now travado por caso', casos })}\n`);
    console.log(`OK: ${casos.length} casos (pulados ${pulados}), ${est.semAgenda} grupos de pagamento sem agenda, ${est.mutaveis} acoes que gravam, ${est.recusas} sem efeito/recusadas -> ${path.relative(process.cwd(), saida)}`);
  } finally { Date.now = dateNow; await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
