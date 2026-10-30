'use strict';

/**
 * Verifica o domínio financeiro portado (Maturacao/29 seção 10) contra o ouro gerado do CÓDIGO REAL do front
 * (scripts/apoio-gf-financeiro/ouro-financeiro-front.json): preços e vigência, saldo, lotes, cobertura do excesso, restrições.
 * Offline: `node scripts/verificar-gf-financeiro.js` (sem banco). Regerar o ouro: scripts/gerar-ouro-gf-financeiro.js --front=<pasta>.
 */

const fs = require('node:fs');
const path = require('node:path');
const { porte } = require('./apoio-gf-financeiro/resumos');

const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-financeiro', 'ouro-financeiro-front.json'), 'utf8'));
const alvo = porte();
const sujo = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));

/** Número com tolerância de 1e-9 (ponto flutuante em reais); todo o resto, igualdade exata. */
function diferenca(a, b, caminho = '') {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > 1e-9 ? `${caminho}: ${a} != ${b}` : null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${caminho}: tamanhos ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i += 1) { const d = diferenca(a[i], b[i], `${caminho}[${i}]`); if (d) return d; }
    return null;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[k] === undefined && b[k] === undefined) continue;
      const d = diferenca(a[k], b[k], `${caminho}.${k}`); if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${caminho}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
}

let ok = 0; const falhas = []; const porTipo = {};
ouro.cenarios.forEach(({ caso, esperado }, indice) => {
  porTipo[caso.tipo] = (porTipo[caso.tipo] || 0) + 1;
  let obtido;
  try { obtido = sujo(alvo[caso.tipo](caso)); } catch (e) { obtido = { erro: e.message, excecao: true }; }
  const d = diferenca(esperado, obtido);
  if (d) falhas.push(`${caso.tipo}#${indice}: ${d}`.slice(0, 300)); else ok += 1;
});
const recusas = ouro.cenarios.filter((c) => c.esperado && c.esperado.erro).length;
console.log(`ouro financeiro: ${ok}/${ouro.cenarios.length} cenários iguais ao código do front (${recusas} recusas do front reproduzidas)`);
console.log(Object.entries(porTipo).map(([k, v]) => `${k}=${v}`).join(' '));
if (falhas.length) { console.error(`${falhas.length} divergências; primeiras:\n${falhas.slice(0, 15).join('\n')}`); process.exit(1); }
