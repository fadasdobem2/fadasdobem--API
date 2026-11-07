'use strict';

/** Utilidades pequenas e puras do núcleo do repasse (comparação de texto, centavos e dinheiro normalizado). */

const { moneyToCents, centsToMoney } = require('./helpers/dinheiro');

const ZERO = 0n;

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function nonNegative(centavos) {
  return centavos > ZERO ? centavos : ZERO;
}
function minCents(...valores) {
  return valores.reduce((baixo, valor) => (valor < baixo ? valor : baixo));
}
function normalizedMoney(texto) {
  return centsToMoney(moneyToCents(texto));
}
function negatedMoney(texto) {
  return centsToMoney(-moneyToCents(texto));
}

module.exports = { ZERO, compareText, nonNegative, minCents, normalizedMoney, negatedMoney };
