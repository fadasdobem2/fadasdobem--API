'use strict';

/**
 * Aritmética monetária em unidades inteiras de 1/10000 BRL (mesma precisão DECIMAL(14,4) das tabelas).
 * Somar/subtrair/comparar sempre em unidades inteiras evita desvio de ponto flutuante e tolerâncias (1e-8).
 */

const SCALE = 10000;

/** @returns {number|null} unidades inteiras (1/10000) ou null se inválido. */
function toUnits(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number.parseFloat(`${value}`.trim().replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * SCALE);
}

function fromUnits(units) {
  const u = Number(units);
  if (!Number.isFinite(u)) return null;
  return Math.round(u) / SCALE;
}

/**
 * Valor em BRL com no máximo 2 casas (centavos, o que o PIX consegue pagar).
 * @returns {number|null} valor em BRL ou null se inválido/mais de 2 casas.
 */
function parseCentavosStrict(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = typeof value === 'number' ? `${value}` : `${value}`.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\d+(\.\d+)?e[+-]?\d+$/i.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) return null;
  return cents / 100;
}

module.exports = { SCALE, toUnits, fromUnits, parseCentavosStrict };
