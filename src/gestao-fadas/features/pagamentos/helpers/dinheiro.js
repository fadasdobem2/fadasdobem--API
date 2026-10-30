'use strict';

/**
 * Porte de features/finance/money-cents.ts (suspiro). Dinheiro em centavos INTEIROS (BigInt), nunca float.
 */

const ZERO = BigInt(0);
const CEM = BigInt(100);

/** Centavos inteiros do texto DECIMAL normalizado de legacyMoney ("-?digits.dd"). */
function moneyToCents(texto) {
  const m = String(texto).match(/^(-?)(\d+)\.(\d{2})$/);
  if (!m) throw new Error(`Valor monetário inválido: ${texto}`);
  const centavos = BigInt(m[2]) * CEM + BigInt(m[3]);
  return m[1] ? -centavos : centavos;
}

function centsToMoney(centavos) {
  const abs = centavos < ZERO ? -centavos : centavos;
  const fracao = String(abs % CEM).padStart(2, '0');
  return `${centavos < ZERO ? '-' : ''}${abs / CEM}.${fracao}`;
}

/** Soma textos em centavos; null é ignorado. */
function sumCents(valores) {
  return valores.reduce((total, v) => (v === null ? total : total + moneyToCents(v)), ZERO);
}

function sumMoney(valores) {
  return centsToMoney(sumCents(valores));
}

module.exports = { moneyToCents, centsToMoney, sumCents, sumMoney };
