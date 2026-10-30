'use strict';

/**
 * Porte de `features/finance/money-cents.ts` (B). Dinheiro é sempre o TEXTO normalizado "-?digitos.dd" e a soma é feita
 * em centavos inteiros (BigInt); nunca em ponto flutuante.
 */

const ZERO = BigInt(0);
const CEM = BigInt(100);

/** Centavos inteiros do texto normalizado por `valorLegado` ("-?digitos.dd"). */
function dinheiroParaCentavos(texto) {
  const m = String(texto).match(/^(-?)(\d+)\.(\d{2})$/);
  if (!m) throw new Error(`Valor monetário inválido: ${texto}`);
  const centavos = BigInt(m[2]) * CEM + BigInt(m[3]);
  return m[1] ? -centavos : centavos;
}

function centavosParaDinheiro(centavos) {
  const abs = centavos < ZERO ? -centavos : centavos;
  const fracao = String(abs % CEM).padStart(2, '0');
  return `${centavos < ZERO ? '-' : ''}${abs / CEM}.${fracao}`;
}

/** Soma textos em centavos; entradas nulas são puladas. */
function somarCentavos(valores) {
  return valores.reduce((total, valor) => (valor === null ? total : total + dinheiroParaCentavos(valor)), ZERO);
}

function somarDinheiro(valores) {
  return centavosParaDinheiro(somarCentavos(valores));
}

module.exports = { dinheiroParaCentavos, centavosParaDinheiro, somarCentavos, somarDinheiro };
