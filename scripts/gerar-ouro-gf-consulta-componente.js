'use strict';

/**
 * Gera o OURO do COMPONENTE da consulta (Maturacao/56 grupo D3): executa o código REAL de `finishConsultation` e `confirmAnnul` (e das funções locais que eles chamam:
 * `validateFinishFields`, `confirmCancellationDecision`, `restoreAgendaAfterInvalidation`) lidas de `consultas/consultations-experience.tsx` pelo harness
 * (`apoio-gf-consulta/componente/harness.js`), sem alterar o front. O estado do React entra pelo caso; os efeitos de tela são gravadores; as funções puras são as reais.
 *   node scripts/gerar-ouro-gf-consulta-componente.js --front=<pasta do front>
 * Grava scripts/apoio-gf-consulta/ouro-componente-front.json. Todo valor é fictício. `saveForm` NÃO entra (ver docs: o menor refactor necessário).
 */

process.env.TZ = 'America/Sao_Paulo';
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const { criar } = require('./apoio-gf-consulta/componente/harness');
const { cenarios } = require('./apoio-gf-consulta/componente/cenarios');
const { executarFinalizar, executarAnular } = require('./apoio-gf-consulta/componente/execucao');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-componente', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  const dateReal = globalThis.Date;
  try {
    const estado = { valores: {} };
    const relogio = { Date: dateReal };
    const h = criar({ vite, front, estado, relogio, locais: {
      reais: ['validateFinishFields', 'finishConsultation', 'confirmAnnul', 'confirmCancellationDecision', 'restoreAgendaAfterInvalidation'],
      gravadores: [/^set[A-Z]/, 'returnFromFinish', 'confirmConsultationOperation', 'launchGrantedBenefit', 'approveFinishReport', 'requestAnnul'],
    } });
    await h.carregar([...h.importacoes.keys()].filter((n) => !/^use[A-Z]/.test(n) && !['useState', 'useMemo', 'useContext', 'useCallback'].includes(n)).filter((n) => {
      const mod = h.importacoes.get(n).mod; return mod.startsWith('@/features/domain') || mod.startsWith('@/features/consultas') || mod.startsWith('./') || mod.startsWith('@/features/tarologas') || mod.startsWith('@/features/agenda') || mod.startsWith('@/features/finance') || mod.startsWith('@/features/shared');
    }));
    const casos = [];
    for (const c of cenarios()) {
      const r = c.tipo === 'finalizar' ? executarFinalizar(h, estado, dateReal, c) : executarAnular(h, estado, dateReal, c);
      casos.push({ ...c, front: r });
    }
    const out = path.join(__dirname, 'apoio-gf-consulta', 'ouro-componente-front.json');
    fs.writeFileSync(out, `${JSON.stringify({ geradoDe: 'consultations-experience.tsx (finishConsultation, confirmAnnul, validateFinishFields, confirmCancellationDecision, restoreAgendaAfterInvalidation) executados pelo harness', casos })}\n`);
    const erros = casos.filter((c) => c.front.toast).length; const gravou = casos.filter((c) => c.front.consulta).length;
    console.log(`OK: ${casos.length} casos (${gravou} gravaram a consulta, ${erros} recusaram com frase da tela) -> ${path.relative(process.cwd(), out)}`);
  } finally { globalThis.Date = dateReal; await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
