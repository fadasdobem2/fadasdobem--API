'use strict';

/**
 * Gera o ouro do horário semanal estruturado do cadastro (v706) A PARTIR DO CÓDIGO REAL DO FRONT: `prepareRegistrationSchedule`
 * (professionals/registration-schedule.ts), `validateRegistrationData` (registration-model.ts, trecho dos horários) e `weeklyScheduleForDate`
 * (domain/formatters.ts). Grava scripts/apoio-gf-cadastros/ouro-horarios-front.json. Uso:
 *   node scripts/gerar-ouro-gf-cadastros-horarios.js --front=<pasta do FRONT com node_modules>
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { gerar } = require('./apoio-gf-cadastros/cenarios-horarios');

const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const front = path.resolve(arg('front') || '');
if (!arg('front') || !fs.existsSync(path.join(front, 'node_modules', 'vite'))) { console.error('Informe --front=<pasta do FRONT com node_modules>.'); process.exit(2); }

(async () => {
  process.env.FADAS_MODE = 'real';
  const { createServer } = await import(pathToFileURL(path.join(front, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
  const vite = await createServer({ root: front, appType: 'custom', configFile: false, define: { __FADAS_NODE_ARTIFACT__: 'true' }, resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error' });
  const modelo = await vite.ssrLoadModule('/features/professionals/registration-model.ts');
  const prep = await vite.ssrLoadModule('/features/professionals/registration-schedule.ts');
  const fmt = await vite.ssrLoadModule('/features/domain/formatters.ts');
  const saida = [];
  for (const c of gerar()) {
    let esperado;
    try {
      if (c.tipo === 'validar') { const r = modelo.validateRegistrationData(c.entrada); esperado = { weeklySchedule: r.weeklySchedule, weeklyScheduleEffectiveFrom: r.weeklyScheduleEffectiveFrom, weeklyScheduleBase: r.weeklyScheduleBase, weeklyScheduleVersions: r.weeklyScheduleVersions }; }
      else if (c.tipo === 'preparar') esperado = prep.prepareRegistrationSchedule(c.proximo, c.anterior, c.hoje);
      else esperado = fmt.weeklyScheduleForDate(c.perfil, c.data);
    } catch (e) { esperado = { erro: e.message }; }
    saida.push({ caso: c, esperado: JSON.parse(JSON.stringify(esperado === undefined ? null : esperado)) });
  }
  await vite.close();
  const destino = path.join(__dirname, 'apoio-gf-cadastros', 'ouro-horarios-front.json');
  fs.writeFileSync(destino, `${JSON.stringify({ gerado: 'a partir do código do front (registration-model.ts, registration-schedule.ts, formatters.ts) na v706', cenarios: saida })}\n`);
  const por = {}; for (const s of saida) { const k = `${s.caso.tipo}${s.esperado && s.esperado.erro ? ':recusa' : ''}`; por[k] = (por[k] || 0) + 1; }
  console.log(`${saida.length} cenários gravados`, JSON.stringify(por));
})().catch((e) => { console.error(e); process.exit(2); });
