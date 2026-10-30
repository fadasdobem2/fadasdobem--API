'use strict';

/**
 * Carrega o CÓDIGO REAL do front (vite ssrLoadModule + calendário real, sem tocar nele) para os geradores de ouro das regras B
 * (Maturacao/44). Determinismo: `crypto.randomUUID` vira uma sequência fixa e o relógio é sempre injetado pelo gerador.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

let contador = 0;
const idFixo = () => { contador += 1; return `00000000-0000-4000-8000-${String(contador).padStart(12, '0')}`; };

async function abrir(pastaDoFront) {
  const front = path.resolve(pastaDoFront);
  if (!fs.existsSync(path.join(front, 'package.json'))) throw new Error('Informe --front=<pasta do front>');
  const req = createRequire(path.join(front, 'package.json'));
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: idFixo, configurable: true });
  const vite = await createServer({
    plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-regras-b', resolve: { alias: { '@': front } },
    server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] },
  });
  return { vite, carregar: (caminho) => vite.ssrLoadModule(caminho), reiniciarIds: () => { contador = 0; }, fechar: () => vite.close() };
}

/** Gerador pseudo-aleatório fixo (o mesmo ouro a cada execução). */
function sorteador(semente) {
  let s = semente >>> 0;
  const alea = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  return { alea, sorteio: (lista) => lista[Math.floor(alea() * lista.length)], inteiro: (a, b) => a + Math.floor(alea() * (b - a + 1)) };
}

const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };

module.exports = { abrir, sorteador, tentar };
