'use strict';

/**
 * Gera os CASOS DE OURO da pendência `guidance:` (Maturacao/41) a partir do CÓDIGO REAL do front:
 *   - `features/painel/panel-pending-items.tsx` (`financialGuidancePendingItems`);
 *   - `features/painel/pending-workflow-model.ts` (`seedFinancialGuidanceRouting`, `reconcilePending`, `pendingSnapshot`);
 *   - `features/clientes/client-financial-guidance-model.ts` (`decideClientFinancialGuidance`: cria os estados reais da orientação).
 * Cada cenário tem dois momentos (A e B) das orientações de algumas clientes: o que a tela deriva em A, a semente dos registros, o que muda em
 * B e o que `reconcilePending` faz. Grava scripts/apoio-gf-pendencias/ouro-orientacao-front.json.
 *   node scripts/gerar-ouro-gf-pendencias-orientacao.js --front=<pasta do front>
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

let semente = 20261201;
const aleatorio = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
const sorteio = (l) => l[Math.floor(aleatorio() * l.length)];
const NOMES = ['Ana Souza', 'Bia Lima', 'Carla Dias', 'Dora Reis', 'Eva Nunes', 'Fabi Rocha'];
const MOTIVOS = ['Cliente pede crédito.', 'Dívida antiga em aberto.', 'Exige autorização da supervisão.', 'Vale uma consulta.', 'Conferir com a supervisora.'];
const tentar = (fn) => { try { return fn(); } catch (_e) { return undefined; } };
const A = '2026-10-30T15:00:00.000Z'; const B = '2026-10-30T16:00:00.000Z';

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-orientacao', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const g = await vite.ssrLoadModule('/features/clientes/client-financial-guidance-model.ts');
    const items = await vite.ssrLoadModule('/features/painel/panel-pending-items.tsx');
    const wf = await vite.ssrLoadModule('/features/painel/pending-workflow-model.ts');
    const plano = (s) => ({ id: s.id, occurrence: s.occurrence, financial: s.financial, tone: s.tone, title: s.title, who: s.who, detail: s.detail });
    let n = 0;
    /** Aplica um comando do front (papel certo) e devolve a orientação nova, ou a antiga se o front recusar. */
    const passo = (atual, action, quando) => {
      n += 1;
      const papel = action === 'request' ? 'atendente' : 'supervisora';
      const comando = { action, reason: sorteio(MOTIVOS), ...(action === 'allow-once' ? { consultationIds: ['c1'] } : {}) };
      return tentar(() => g.decideClientFinancialGuidance(atual, comando, papel, 'Khloe', quando, `ev-${n}`, atual ? atual.revision : 0)) || atual;
    };
    const perfis = (estado) => Object.fromEntries(Object.entries(estado).filter(([, v]) => v.guidance).map(([id, v]) => [id, { clientId: id, name: v.nome, financialGuidance: v.guidance }]));
    const cenarios = [];
    for (let i = 0; i < 160; i += 1) {
      const total = 1 + Math.floor(aleatorio() * 4);
      const ids = Array.from({ length: total }, (_, k) => `${900100 + k * 7 + (i % 5)}`);
      const estadoA = Object.fromEntries(ids.map((id) => {
        let guid; const cadeia = Math.floor(aleatorio() * 4);
        for (let k = 0; k <= cadeia; k += 1) guid = passo(guid, sorteio(['request', 'request', 'require', 'allow-once', 'release', 'close-alert']), A);
        return [id, { nome: sorteio(NOMES), guidance: guid }];
      }));
      const estadoB = Object.fromEntries(Object.entries(estadoA).map(([id, v]) => {
        let guid = v.guidance;
        if (aleatorio() < 0.7) guid = passo(guid, sorteio(['request', 'release', 'close-alert', 'allow-once', 'require']), B);
        return [id, { nome: v.nome, guidance: guid }];
      }));
      const itensDe = (estado) => items.financialGuidancePendingItems(perfis(estado), () => {});
      const fontesA = itensDe(estadoA); const fontesB = itensDe(estadoB);
      const registrosA = wf.seedFinancialGuidanceRouting({}, fontesA);
      const originIds = new Set(Object.keys(perfis(estadoB)).map((id) => `guidance:${id}`));
      const origemA = new Set(Object.keys(perfis(estadoA)).map((id) => `guidance:${id}`));
      const aposA = wf.reconcilePending(registrosA, fontesA, origemA, A);
      const registrosB = wf.seedFinancialGuidanceRouting(wf.reconcilePending(aposA, fontesB, originIds, B), fontesB);
      cenarios.push({
        a: Object.entries(estadoA).map(([clientId, v]) => ({ clientId, nome: v.nome, guidance: v.guidance || null })), b: Object.entries(estadoB).map(([clientId, v]) => ({ clientId, nome: v.nome, guidance: v.guidance || null })),
        itensA: fontesA.map(plano), itensB: fontesB.map(plano), registrosA: JSON.parse(JSON.stringify(aposA)), registrosB: JSON.parse(JSON.stringify(registrosB)),
      });
    }
    const saida = path.join(__dirname, 'apoio-gf-pendencias', 'ouro-orientacao-front.json');
    fs.writeFileSync(saida, JSON.stringify({ geradoDe: 'features/painel/panel-pending-items.tsx, pending-workflow-model.ts, client-financial-guidance-model.ts', A, B, cenarios }));
    const comItens = cenarios.filter((c) => c.itensA.length).length;
    console.log(`Ouro gravado: ${cenarios.length} cenários (${comItens} com pendência de orientação em A; ${cenarios.reduce((s, c) => s + Object.values(c.registrosB).filter((r) => r.resolvedAt).length, 0)} registros resolvidos).`);
  } finally { await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
