'use strict';

/**
 * Texto com formatação (negrito, itálico, destaque): porte de `normalizeTextFormatting` de `features/shared/formatted-text-model.ts` do front.
 * O texto puro manda; os deslocamentos são UTF-16 como na seleção do DOM. Rejeita formatação velha ou mal formada (devolve undefined).
 */

const ESTILOS = ['bold', 'italic', 'highlight'];
const mesmasMarcas = (a, b) => ESTILOS.every((k) => a[k] === b[k]);
const quebraSubstituto = (t, p) => p > 0 && p < t.length && /[\uD800-\uDBFF]/.test(t[p - 1]) && /[\uDC00-\uDFFF]/.test(t[p]);

function canonica(texto, faixas) {
  if (!texto || !faixas.length) return undefined;
  const pontos = new Map();
  for (const f of faixas) {
    const ini = Math.max(0, f.start); const fim = Math.min(texto.length, f.end);
    if (ini >= fim) continue;
    for (const [pos, qtd] of [[ini, 1], [fim, -1]]) {
      const ev = pontos.get(pos) || { bold: 0, italic: 0, highlight: 0 };
      for (const k of ESTILOS) if (f[k]) ev[k] += qtd;
      pontos.set(pos, ev);
    }
  }
  const posicoes = [...pontos.keys()].sort((a, b) => a - b);
  const cont = { bold: 0, italic: 0, highlight: 0 }; const saida = [];
  for (let i = 0; i < posicoes.length - 1; i += 1) {
    const ini = posicoes[i]; const fim = posicoes[i + 1]; const ev = pontos.get(ini);
    for (const k of ESTILOS) cont[k] += ev[k];
    const marcas = {};
    for (const k of ESTILOS) if (cont[k] > 0) marcas[k] = true;
    if (!Object.keys(marcas).length || ini === fim) continue;
    const anterior = saida[saida.length - 1];
    if (anterior && anterior.end === ini && mesmasMarcas(anterior, marcas)) anterior.end = fim; else saida.push({ start: ini, end: fim, ...marcas });
  }
  return saida.length ? { version: 1, text: texto, ranges: saida } : undefined;
}

function normalizar(texto, valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return undefined;
  if (valor.version !== 1 || typeof valor.text !== 'string' || !Array.isArray(valor.ranges) || valor.ranges.length > 10000) return undefined;
  const original = valor.text;
  if (original !== texto && original.trim() !== texto) return undefined;
  const deslocamento = original === texto ? 0 : original.length - original.trimStart().length;
  const faixas = [];
  for (const c of valor.ranges) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return undefined;
    if (!Number.isSafeInteger(c.start) || !Number.isSafeInteger(c.end)) return undefined;
    if (c.start < 0 || c.end <= c.start || c.end > original.length || quebraSubstituto(original, c.start) || quebraSubstituto(original, c.end) || ESTILOS.some((k) => c[k] !== undefined && c[k] !== true)) return undefined;
    const marcas = {};
    for (const k of ESTILOS) if (c[k] === true) marcas[k] = true;
    if (!Object.keys(marcas).length) return undefined;
    faixas.push({ start: c.start - deslocamento, end: c.end - deslocamento, ...marcas });
  }
  return canonica(texto, faixas);
}

module.exports = { normalizar };
