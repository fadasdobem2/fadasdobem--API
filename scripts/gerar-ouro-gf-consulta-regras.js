'use strict';

/**
 * Gera o OURO das REGRAS da consulta no servidor (Maturacao/38) a partir do CÓDIGO REAL do front (vite + funções reais):
 *   node scripts/gerar-ouro-gf-consulta-regras.js --front=<pasta do front> [--so=vinculos,conferencia,desfechos,autorizacao,edicao]
 * Grava scripts/apoio-gf-consulta/ouro-regras-<nome>-front.json. Todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));
const MODULOS = ['vinculos', 'conferencia', 'desfechos', 'autorizacao', 'edicao'];
const escolhidos = arg('so') ? arg('so').split(',') : MODULOS;

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-regras', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    for (const nome of escolhidos) {
      const arquivo = path.join(__dirname, 'apoio-gf-consulta', 'regras', `gerar-${nome}.js`);
      if (!fs.existsSync(arquivo)) { console.log(`(sem gerador: ${nome})`); continue; }
      const { cenarios, casos } = await require(arquivo).gerar({ vite, front });
      fs.writeFileSync(path.join(__dirname, 'apoio-gf-consulta', `ouro-regras-${nome}-front.json`), JSON.stringify({ geradoDe: `código real do front (${nome})`, cenarios, casos }));
      console.log(`Ouro ${nome}: ${casos.length} casos, ${cenarios.length} cenários.`);
    }
  } finally { await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
