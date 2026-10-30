'use strict';

/**
 * Gera o OURO da CORREÇÃO DE TEMPO da consulta no servidor (Maturacao/35) a partir do CÓDIGO do front:
 * `consultas/consultation-time-correction.ts` (`correctConsultationTime`, com `validateTimeCorrectionCoverage` e o saldo real do cenário).
 * Cenários de consultas, pagamentos e perfil do ouro financeiro (`apoio-gf-financeiro/cenarios.js`, semente fixa).
 *   node scripts/gerar-ouro-gf-consulta-correcao.js --front=<pasta do front>
 * Grava scripts/apoio-gf-consulta/ouro-correcao-front.json. Todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const { gerarCenarios } = require('./apoio-gf-financeiro/cenarios');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));
const FECHADAS = ['Concluída', 'Finalizada pelo tarólogo', 'Cancelada', 'Desistiu'];
const EM = '2026-10-31T16:00:00.000Z';

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-correcao', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const corr = await vite.ssrLoadModule('/features/consultas/consultation-time-correction.ts');
    const cenarios = []; const casos = []; let aceitas = 0; let recusasDeSaldo = 0;
    for (const c of gerarCenarios()) {
      if (c.tipo !== 'tarifa' || !c.perfil) continue;
      const idx = cenarios.push({ consultas: c.consultas, pagamentos: c.pagamentos, perfil: c.perfil }) - 1;
      for (const item of c.consultas.filter((x) => FECHADAS.includes(x.status))) {
        for (const [k, minutos] of [10, 25, 40, 90].entries()) {
          const alvo = k === 3 && !item.tarologistFinishReport ? { ...item, tarologistFinishReport: { minutes: Math.max(1, Math.ceil(item.durationSeconds / 60)), submittedAt: item.startedAt, endedAt: item.endedAt, reporterTarotId: item.tarotId, reporterName: 'Osíris' } } : item;
          const lista = c.consultas.map((x) => (x.id === item.id ? alvo : x));
          let resultado;
          try { resultado = { ok: corr.correctConsultationTime(alvo, minutos, 'Divergência D1; solicitada por Osíris: ajuste', 'Laya', EM, alvo.updatedAt, { consultations: lista, payments: c.pagamentos, profile: c.perfil }) }; aceitas += 1; } catch (e) { resultado = { erro: e instanceof Error ? e.message : String(e) }; if (/saldo/.test(resultado.erro)) recusasDeSaldo += 1; }
          casos.push({ idx, item: alvo, minutos, resultado });
        }
      }
    }
    fs.writeFileSync(path.join(__dirname, 'apoio-gf-consulta', 'ouro-correcao-front.json'), JSON.stringify({ geradoDe: 'consultation-time-correction.ts do front', em: EM, cenarios, casos }));
    console.log(`Ouro gravado: ${casos.length} correções (${aceitas} aceitas, ${recusasDeSaldo} recusadas por saldo, ${casos.length - aceitas - recusasDeSaldo} por outra regra).`);
  } finally { await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
