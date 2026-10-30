'use strict';

/**
 * Gera os CASOS DE OURO da Ficha da cliente (Maturacao/36) a partir do CÓDIGO do front:
 *   - `features/clientes/client-financial-guidance-model.ts` (`decideClientFinancialGuidance`, `validClientFinancialGuidance`);
 *   - `features/clientes/client-profile-model.ts` (`appendClientNote`, `editClientNote`) e `features/shared/formatted-text-model.ts` (`normalizeTextFormatting`).
 * Grava entradas e saídas em scripts/apoio-gf-ficha/ouro-ficha-front.json.
 *   node scripts/gerar-ouro-gf-ficha.js --front=<pasta do front>
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

const PAPEIS = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];
const ACOES = ['request', 'require', 'allow-once', 'release', 'close-alert', 'lixo'];
const AGORA = '2026-10-30T15:00:00.000Z';
const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-ficha', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const g = await vite.ssrLoadModule('/features/clientes/client-financial-guidance-model.ts');
    const p = await vite.ssrLoadModule('/features/clientes/client-profile-model.ts');
    const t = await vite.ssrLoadModule('/features/shared/formatted-text-model.ts');
    // Orientação: cada papel faz cada ação sobre (nada) e sobre registros de cada estado.
    const orient = [];
    let n = 0;
    const base = (c) => ({ action: c.action, reason: c.reason, ...(c.consultationIds ? { consultationIds: c.consultationIds } : {}) });
    const comandos = [];
    for (const action of ACOES) for (const reason of ['  Cliente pede crédito.  ', '', 'x'.repeat(1001), 'a\u0001b']) comandos.push({ action, reason, ...(action === 'allow-once' ? { consultationIds: ['c1', 'c2', 'c1'] } : {}) });
    comandos.push({ action: 'allow-once', reason: 'Vale uma.' }, { action: 'allow-once', reason: 'Vale uma.', consultationIds: [1] });
    const estados = [undefined];
    for (const action of ['request', 'require', 'allow-once', 'release', 'close-alert']) {
      const r = tentar(() => g.decideClientFinancialGuidance(undefined, { action, reason: 'Estado de partida.', ...(action === 'allow-once' ? { consultationIds: ['c0'] } : {}) }, action === 'request' ? 'atendente' : 'supervisora', 'Clara', '2026-10-01T10:00:00.000Z', `e-${action}`));
      if (r.ok) estados.push(r.ok);
    }
    for (const papel of PAPEIS) for (const atual of estados) for (const c of comandos) for (const esperada of [atual ? atual.revision : 0, 7]) {
      n += 1;
      const r = tentar(() => g.decideClientFinancialGuidance(atual, c, papel, 'Khloe', AGORA, `ev-${n}`, esperada));
      orient.push({ atual: atual || null, comando: c, papel, ator: 'Khloe', em: AGORA, id: `ev-${n}`, esperada, resultado: r.ok || null, erro: r.erro || null });
    }
    // Repetição do mesmo evento (id já no histórico) devolve o registro como está.
    const rep = estados[1] ? { atual: estados[1], comando: { action: 'request', reason: 'Outra.' }, papel: 'atendente', ator: 'Khloe', em: AGORA, id: estados[1].history[0].id, esperada: estados[1].revision } : null;
    if (rep) { const r = tentar(() => g.decideClientFinancialGuidance(rep.atual, rep.comando, rep.papel, rep.ator, rep.em, rep.id, rep.esperada)); orient.push({ ...rep, resultado: r.ok || null, erro: r.erro || null }); }
    const formas = estados.filter(Boolean).map((e) => ({ valor: e, valida: g.validClientFinancialGuidance(e) }));
    formas.push({ valor: { revision: 0 }, valida: false }, { valor: null, valida: false });
    // Observações.
    const textos = ['  Prefere WhatsApp.  ', '', '   ', 'x'.repeat(4001), 'x'.repeat(4000), 'a\u0001b', 'linha 1\nlinha 2', 'ok \u{1F600}'];
    const fmt = (text) => ({ version: 1, text, ranges: [{ start: 0, end: Math.min(3, text.length), bold: true }, { start: 1, end: Math.min(4, text.length), italic: true }] });
    const notas = [];
    for (const text of textos) for (const formatting of [undefined, fmt(text), { version: 1, text: 'outro', ranges: [] }]) {
      const a = tentar(() => p.appendClientNote([], '900013', text, 'Khloe', 'n1', AGORA, 'atendente', formatting));
      notas.push({ tipo: 'criar', text, formatting: formatting || null, resultado: a.ok ? a.ok[0] : null, erro: a.erro || null });
    }
    const previa = p.appendClientNote([], '900013', 'Texto antigo.', 'Khloe', 'n1', '2026-10-01T10:00:00.000Z', 'atendente')[0];
    const previaFmt = p.appendClientNote([], '900013', 'Texto antigo.', 'Khloe', 'n2', '2026-10-01T10:00:00.000Z', 'atendente', fmt('Texto antigo.'))[0];
    for (const atual of [previa, previaFmt]) for (const role of PAPEIS) for (const [text, formatting] of [['Texto antigo.', undefined], ['Texto novo.', undefined], ['Texto antigo.', fmt('Texto antigo.')], ['  Texto novo.  ', fmt('Texto novo.')], ['', undefined]]) {
      const e = tentar(() => p.editClientNote([atual], atual.clientId, atual.id, text, 'Clara', role, AGORA, formatting));
      notas.push({ tipo: 'editar', atual, role, text, formatting: formatting || null, resultado: e.ok ? e.ok[0] : null, erro: e.erro || null });
    }
    const normal = [];
    for (const text of ['Olá mundo', ' Olá ', 'a😀b']) for (const f of [fmt(text), fmt(text.trim()), { version: 2, text, ranges: [] }, { version: 1, text, ranges: [{ start: 0, end: 99, bold: true }] }, { version: 1, text, ranges: [{ start: 0, end: 2, bold: false }] }, { version: 1, text, ranges: [{ start: 1, end: 2, bold: true, highlight: true }, { start: 2, end: 4, bold: true, highlight: true }] }, null, 'x']) {
      normal.push({ text, formatting: f, saida: t.normalizeTextFormatting(text, f) ?? null });
    }
    const saida = path.join(__dirname, 'apoio-gf-ficha', 'ouro-ficha-front.json');
    fs.writeFileSync(saida, JSON.stringify({ geradoDe: 'features/clientes/client-financial-guidance-model.ts, client-profile-model.ts, shared/formatted-text-model.ts', agora: AGORA, orient, formas, notas, normal }));
    console.log(`Ouro gravado: ${orient.length} orientações, ${formas.length} formas, ${notas.length} observações, ${normal.length} formatações.`);
  } finally { await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
