'use strict';

/**
 * Gera os CASOS DE OURO das Pendências (Maturacao/34) a partir do CÓDIGO do front: `features/painel/pending-workflow-model.ts`
 * (`pendingKey`, `initialPendingQueue`, `pendingVisible`, `canTransferPending`, `transferPending`, `reconcilePending`, `seedFinancialGuidanceRouting`).
 * Grava entradas e saídas em scripts/apoio-gf-pendencias/ouro-pendencias-front.json.
 *   node scripts/gerar-ouro-gf-pendencias.js --front=<pasta do front>
 * Usa o vite do próprio front (ssrLoadModule) com o calendário real, sem tocar nele. Todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));

const TONS = ['guidance', 'cancellation', 'addition', 'finish', 'divergence', 'match', 'payment'];
const PAPEIS = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];
const FILAS = ['atendimento', 'supervisao', 'financeiro', 'administracao'];
const AGORA = '2026-10-30T15:00:00.000Z';

function snaps() {
  const lista = [];
  for (const tone of TONS) for (const financial of [false, true]) lista.push({ id: `${tone}:${lista.length}`, occurrence: `occ-${lista.length}`, financial, tone, title: `Titulo ${tone}`, who: '900013 · Cliente Ficção', detail: `Detalhe ${tone}`, ...(lista.length % 3 === 0 ? { referenceDate: '2026-10-30' } : {}) });
  return lista;
}

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-pendencias', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const m = await vite.ssrLoadModule('/features/painel/pending-workflow-model.ts');
    const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
    const base = snaps();
    const chaves = base.map((s) => ({ snapshot: s, key: m.pendingKey(s), fila: m.initialPendingQueue(s), visivel: Object.fromEntries(PAPEIS.map((p) => [p, m.pendingVisible(p, s)])) }));
    const encaminhar = [];
    for (const s of base) for (const papel of PAPEIS) for (const de of FILAS) for (const para of FILAS) {
      const pode = m.canTransferPending(papel, de, para, s.financial, s.tone);
      const antes = { [m.pendingKey(s)]: { key: m.pendingKey(s), snapshot: s, queue: de, events: [] } };
      const feito = tentar(() => m.transferPending(antes, s, para, '  Conferir isto.  ', { id: 'u1', name: 'Fulana', role: papel }, AGORA));
      encaminhar.push({ papel, de, para, snapshot: s, pode, antes: antes[m.pendingKey(s)], resultado: feito.ok ? feito.ok[m.pendingKey(s)] : null, erro: feito.erro || null });
    }
    // reconcile: resolve e reabre.
    const reconciliar = [];
    for (const s of base) {
      const k = m.pendingKey(s);
      const fila = m.initialPendingQueue(s);
      const rec = { key: k, snapshot: s, queue: fila, events: [] };
      const resolvida = m.reconcilePending({ [k]: rec }, [], new Set([s.id]), AGORA)[k];
      const reaberta = m.reconcilePending({ [k]: resolvida }, [s], new Set([s.id]), '2026-10-30T16:00:00.000Z')[k];
      const semente = m.seedFinancialGuidanceRouting({}, [s])[k] || null;
      reconciliar.push({ antes: rec, resolvida, reaberta, semente });
    }
    const saida = path.join(__dirname, 'apoio-gf-pendencias', 'ouro-pendencias-front.json');
    fs.writeFileSync(saida, JSON.stringify({ geradoDe: 'features/painel/pending-workflow-model.ts', agora: AGORA, chaves, encaminhar, reconciliar }));
    console.log(`Ouro gravado: ${chaves.length} chaves, ${encaminhar.length} encaminhamentos, ${reconciliar.length} reconciliações.`);
  } finally { await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
