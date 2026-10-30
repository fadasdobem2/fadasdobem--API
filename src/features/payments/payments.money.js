'use strict';

/**
 * Dinheiro em CENTAVOS INTEIROS (F-12/F-15). Nunca somar `Number` de reais.
 *
 * Regra de arredondamento (única, definida aqui): valores em reais são lidos como texto decimal
 * exato (número JS passa por `toFixed(8)` para eliminar ruído binário, ex.: 0.1 + 0.2) e
 * arredondados para 2 casas com MEIO PARA CIMA (0,125 vira 0,13; 0,124 vira 0,12).
 * Proporções (ex.: estorno parcial) usam BigInt com a mesma regra (meio para cima).
 * O banco guarda DECIMAL(14,4), mas tudo que a API grava aqui tem no máximo 2 casas.
 */

/** @returns {number|null} centavos inteiros, ou null se o valor não for numérico. */
function toCents(value) {
  if (value == null || value === '') return null;
  let s;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    s = value.toFixed(8);
  } else {
    s = String(value).trim();
  }
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
  const neg = s.startsWith('-');
  s = s.replace(/^[+-]/, '');
  const [inteiro, frac = ''] = s.split('.');
  const f = `${frac}000`.slice(0, 3);
  let cents = Number(inteiro) * 100 + Number(f.slice(0, 2));
  if (Number(f[2]) >= 5) cents += 1;
  return neg ? -cents : cents;
}

/** Centavos inteiros para texto decimal exato com 2 casas ("12.34"), próprio para colunas DECIMAL. */
function centsToString(cents) {
  const c = Math.trunc(Number(cents));
  const neg = c < 0;
  const abs = Math.abs(c);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** Centavos para `Number` em reais (somente para exibição/retorno; nunca para somar). */
function centsToNumber(cents) {
  return Number(centsToString(cents));
}

/** (a * b) / c com BigInt, arredondando meio para cima (valores não negativos). */
function mulDivRound(a, b, c) {
  const den = BigInt(c);
  if (den <= 0n) return 0;
  return Number((BigInt(a) * BigInt(b) * 2n + den) / (2n * den));
}

/** Compatível com o antigo: `Number` em reais com 2 casas, ou null se não positivo/inválido. */
function roundMoney(n) {
  const c = toCents(n);
  if (c == null || c <= 0) return null;
  return centsToNumber(c);
}

module.exports = { toCents, centsToString, centsToNumber, mulDivRound, roundMoney };
