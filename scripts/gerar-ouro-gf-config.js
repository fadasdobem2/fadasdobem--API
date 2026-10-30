'use strict';

/**
 * Gera o ouro das Boas-vindas (scripts/apoio-gf-config/ouro-welcome-front.json) A PARTIR DO CÓDIGO REAL DO FRONT:
 * `validateWelcome` de features/auth/welcome-model.ts, com os cenários de scripts/apoio-gf-config/cenarios.js. Só precisa
 * rodar de novo quando o front mudar a validação. Uso (o FRONT tem de ter node_modules):
 *   node scripts/gerar-ouro-gf-config.js --front=<pasta do FRONT com node_modules>
 * Nada no front é alterado. Roda o vite em modo SSR com a marca de artefato Node e FADAS_MODE=real.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { CENARIOS } = require('./apoio-gf-config/cenarios');

const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const front = path.resolve(arg('front') || '');
if (!arg('front') || !fs.existsSync(path.join(front, 'node_modules', 'vite'))) { console.error('Informe --front=<pasta do FRONT com node_modules>.'); process.exit(2); }

(async () => {
  process.env.FADAS_MODE = 'real';
  const { createServer } = await import(pathToFileURL(path.join(front, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
  const vite = await createServer({ root: front, appType: 'custom', configFile: false, define: { __FADAS_NODE_ARTIFACT__: 'true' }, resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error' });
  const modelo = await vite.ssrLoadModule('/features/auth/welcome-model.ts');
  const saida = [];
  for (const c of CENARIOS) {
    let resultado;
    try { resultado = { conteudo: JSON.parse(JSON.stringify(modelo.validateWelcome(JSON.parse(JSON.stringify(c.conteudo === undefined ? null : c.conteudo))))) }; } catch (e) { resultado = { erro: e.message }; }
    saida.push({ nome: c.nome, ...resultado });
  }
  const padrao = JSON.parse(JSON.stringify(modelo.DEFAULT_WELCOME));
  await vite.close();
  const destino = path.join(__dirname, 'apoio-gf-config', 'ouro-welcome-front.json');
  fs.writeFileSync(destino, `${JSON.stringify({ gerado: 'a partir do código do front (features/auth/welcome-model.ts: validateWelcome e DEFAULT_WELCOME)', padrao, cenarios: saida }, null, 1)}\n`);
  console.log(`${saida.length} cenários gravados em ${path.relative(process.cwd(), destino)} (${saida.filter((s) => s.erro).length} com recusa)`);
})().catch((e) => { console.error(e); process.exit(2); });
