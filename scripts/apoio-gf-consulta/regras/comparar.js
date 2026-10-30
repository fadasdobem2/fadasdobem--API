'use strict';

const { estavel } = require('../../../src/gestao-fadas/features/financeiro-cliente/fin.comum');

/** Igualdade por valor com chaves em ordem estável, sem `undefined` (o ouro é JSON). */
const jsonIgual = (a, b) => estavel(JSON.parse(JSON.stringify(a === undefined ? null : a))) === estavel(JSON.parse(JSON.stringify(b === undefined ? null : b)));

module.exports = { jsonIgual };
