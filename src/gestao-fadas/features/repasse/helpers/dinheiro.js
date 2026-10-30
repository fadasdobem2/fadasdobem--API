'use strict';

/**
 * Dinheiro em centavos inteiros (BigInt), nunca em ponto flutuante. Entra o texto DECIMAL normalizado
 * ("-?digitos.dd") e sai o texto "123.45". Porta de `features/finance/money-cents.ts` (B).
 */

const ZERO = 0n;
const CEM = 100n;

function moneyToCents(texto) {
  if (typeof texto !== 'string') throw new Error(`Valor monetário inválido: ${texto}`);
  const m = texto.match(/^(-?)(\d+)\.(\d{2})$/);
  if (!m) throw new Error(`Valor monetário inválido: ${texto}`);
  const centavos = BigInt(m[2]) * CEM + BigInt(m[3]);
  return m[1] ? -centavos : centavos;
}

function centsToMoney(centavos) {
  const abs = centavos < ZERO ? -centavos : centavos;
  const fracao = String(abs % CEM).padStart(2, '0');
  return `${centavos < ZERO ? '-' : ''}${abs / CEM}.${fracao}`;
}

/** Soma textos em centavos; entradas nulas são puladas. */
function sumCents(valores) {
  return valores.reduce((total, valor) => (valor === null ? total : total + moneyToCents(valor)), ZERO);
}

function sumMoney(valores) {
  return centsToMoney(sumCents(valores));
}

module.exports = { moneyToCents, centsToMoney, sumCents, sumMoney };
