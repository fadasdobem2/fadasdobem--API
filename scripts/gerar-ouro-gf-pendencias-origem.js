'use strict';

/**
 * Gera o OURO da DERIVAÇÃO das Pendências no servidor (Maturacao/35) a partir do CÓDIGO do front: `painel/panel-model.ts` (`panelData`),
 * `painel/panel-pending-items.tsx` (`panelPendingItems`), `painel/pending-workflow-model.ts` (`reconcilePending`, `retainRoutedMatches`,
 * `transferPending`) e as datas e `originIds` de `painel/staff-operations-context.tsx` (copiados do trecho, com a mesma ordem).
 *   node scripts/gerar-ouro-gf-pendencias-origem.js --front=<pasta do front>
 * Cenários sorteados com semente fixa; o relógio do front (`Date.now`) é fixado em 12/10/2026 13:00 (-03:00). Todo valor é fictício.
 * Grava scripts/apoio-gf-pendencias/ouro-origem-front.json.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));
const { cenario } = require('./apoio-gf-pendencias/cenarios-origem');

const AGORA = Date.parse('2026-10-12T13:00:00-03:00');
const DIA = '2026-10-12';

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-pend-origem', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  const realNow = Date.now; Date.now = () => AGORA;
  try {
    const pm = await vite.ssrLoadModule('/features/painel/panel-model.ts');
    const pi = await vite.ssrLoadModule('/features/painel/panel-pending-items.tsx');
    const wf = await vite.ssrLoadModule('/features/painel/pending-workflow-model.ts');
    const noop = () => {};
    const itensDe = (e, data, registros) => pi.panelPendingItems(wf.retainRoutedMatches(pm.panelData('administradora', e.consultas, e.pagamentos, e.divergencias, e.agenda, data), registros, e.consultas, data), noop, noop, data, undefined).map((i) => wf.pendingSnapshot(i));
    /** Espelho do trecho de staff-operations-context.tsx (datas, fontes e origens). */
    const fontesDe = (e, registros) => {
      const records = Object.fromEntries(registros.map((r) => [r.key, r]));
      const datas = new Set([DIA, ...Object.values(records).flatMap((r) => (r.snapshot.referenceDate ? [r.snapshot.referenceDate] : [])), ...Object.values(records).flatMap((r) => { const k = r.snapshot.id.split(':')[0]; if (k !== 'match' && k !== 'unpaid') return []; const a = e.agenda.find((i) => r.snapshot.id === `${k}:${i.id}`); return a && a.date ? [a.date] : []; })]);
      const mapa = new Map([...datas].flatMap((d) => itensDe(e, d, records)).map((i) => [wf.pendingKey(i), i]));
      const origens = new Set([...e.consultas.flatMap((c) => [`finish:${c.id}`, `uncovered:${c.id}`, `cancellation:${c.id}`]), ...e.agenda.flatMap((i) => [`match:${i.id}`, `unpaid:${i.id}`]), ...e.divergencias.map((i) => `divergence:${i.id}`)]);
      return { records, datas: [...datas], mapa, origens, sources: [...mapa.values()] };
    };
    const casos = []; const contagem = {};
    for (let k = 0; k < 140; k += 1) {
      const c = cenario(k, DIA);
      // 1) com as fontes iniciais, escolhe quais pendências já foram encaminhadas (registro) e algumas já resolvidas.
      const inicial = fontesDe(c.antes, []);
      const registros = [];
      inicial.sources.forEach((s, i) => { if (c.sorteio() < 0.7) registros.push({ key: wf.pendingKey(s), snapshot: s, queue: wf.initialPendingQueue(s), events: [], ...(c.sorteio() < 0.15 ? { resolvedAt: '2026-10-12T10:00:00.000Z' } : {}) }); });
      // 2) o mundo muda (c.depois) e o front reconcilia.
      const agora = fontesDe(c.depois, registros);
      const reconc = wf.reconcilePending(agora.records, agora.sources, agora.origens, '2026-10-12T16:00:00.000Z');
      const resolvidas = Object.keys(reconc).filter((key) => reconc[key] !== agora.records[key] && reconc[key].resolvedAt && !agora.records[key].resolvedAt);
      const reabertas = Object.keys(reconc).filter((key) => reconc[key] !== agora.records[key] && !reconc[key].resolvedAt && agora.records[key].resolvedAt);
      // 3) encaminhar o que o front aceita (atendente: atendimento -> supervisão), com o motivo do usuário.
      const encaminhadas = [];
      for (const s of agora.sources) {
        try { const feito = wf.transferPending(reconc, s, 'supervisao', '  Conferir.  ', { id: 'u1', name: 'Khloe', role: 'atendente' }, '2026-10-12T16:30:00.000Z'); encaminhadas.push({ snapshot: s, antes: reconc[wf.pendingKey(s)] || null, depois: feito[wf.pendingKey(s)] }); } catch (_) { /* o front recusa */ }
      }
      for (const s of agora.sources) contagem[s.id.split(':')[0]] = (contagem[s.id.split(':')[0]] || 0) + 1;
      casos.push({ entrada: c.depois, registros, datas: agora.datas, fontes: [...agora.mapa.entries()], origens: [...agora.origens].sort(), reconciliado: reconc, resolvidas, reabertas, encaminhadas });
    }
    const saida = path.join(__dirname, 'apoio-gf-pendencias', 'ouro-origem-front.json');
    fs.writeFileSync(saida, JSON.stringify({ geradoDe: 'panel-model.ts, panel-pending-items.tsx, pending-workflow-model.ts, staff-operations-context.tsx do front', dia: DIA, agora: AGORA, casos }));
    const resolvidas = casos.reduce((s, x) => s + x.resolvidas.length, 0); const reabertas = casos.reduce((s, x) => s + x.reabertas.length, 0);
    console.log(`Ouro gravado: ${casos.length} cenários; fontes por tipo ${JSON.stringify(contagem)}; resolvidas ${resolvidas}, reabertas ${reabertas}, encaminhamentos ${casos.reduce((s, x) => s + x.encaminhadas.length, 0)}.`);
  } finally { Date.now = realNow; await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
