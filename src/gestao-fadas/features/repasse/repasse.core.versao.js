'use strict';

/** Versão do resultado (R15): JSON canônico e SHA-256. */

const { createHash } = require('crypto');
const { compareText } = require('./repasse.core.util');

// ---- Versão do resultado (R15) ----

function canonicalJson(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canonicalJson).join(',')}]`;
  if (valor !== null && typeof valor === 'object') {
    const entries = Object.entries(valor).filter(([, item]) => item !== undefined).sort(([a], [b]) => compareText(a, b));
    return `{${entries.map(([chave, item]) => `${JSON.stringify(chave)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(valor) ?? 'null';
}

/** SHA-256 em hexadecimal do JSON canônico (chaves em ordem). Serve para as linhas da composição e para as de A pagar. */
function payoutVersion(valor) {
  return createHash('sha256').update(canonicalJson(valor)).digest('hex');
}

module.exports = { payoutVersion };
