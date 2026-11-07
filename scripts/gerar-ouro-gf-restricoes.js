'use strict';

/**
 * Gera o ouro das Restrições da v706 (scripts/apoio-gf-restricoes/ouro-restricoes-front.json) A PARTIR DO CÓDIGO REAL DO FRONT:
 * `changeRestriction` e `ownRestrictionClientIds` (features/restricoes/restriction-model.ts). Uso:
 *   node scripts/gerar-ouro-gf-restricoes.js --front=<pasta do FRONT com node_modules>
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { gerar } = require('./apoio-gf-restricoes/cenarios');

const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const front = path.resolve(arg('front') || '');
if (!arg('front') || !fs.existsSync(path.join(front, 'node_modules', 'vite'))) { console.error('Informe --front=<pasta do FRONT com node_modules>.'); process.exit(2); }

(async () => {
  process.env.FADAS_MODE = 'real';
  const { createServer } = await import(pathToFileURL(path.join(front, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
  const vite = await createServer({ root: front, appType: 'custom', configFile: false, define: { __FADAS_NODE_ARTIFACT__: 'true' }, resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error' });
  const modelo = await vite.ssrLoadModule('/features/restricoes/restriction-model.ts');
  const saida = [];
  for (const c of gerar()) {
    let esperado;
    try { esperado = c.tipo === 'alterar' ? modelo.changeRestriction(c.linhas, c.entrada) : modelo.ownRestrictionClientIds(c.consultas, c.linhas, c.tarotId); } catch (e) { esperado = { erro: e.message }; }
    saida.push({ caso: c, esperado: JSON.parse(JSON.stringify(esperado === undefined ? null : esperado)) });
  }
  await vite.close();
  const destino = path.join(__dirname, 'apoio-gf-restricoes', 'ouro-restricoes-front.json');
  fs.writeFileSync(destino, `${JSON.stringify({ gerado: 'a partir do código do front (restriction-model.ts, v706)', cenarios: saida })}\n`);
  console.log(`${saida.length} cenários gravados (${saida.filter((s) => s.esperado && s.esperado.erro).length} com recusa do front)`);
})().catch((e) => { console.error(e); process.exit(2); });
