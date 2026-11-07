'use strict';

/** Dinheiro dos campos da tela: texto digitado para o texto do contrato e de volta. */

const FIELD_MONEY = /^\d+(?:\.\d{3})*(?:,\d{1,2})?$/;

/** "1.234,5" como o contrato o quer ("1234.50"), ou null. Só o saldo e a pendência aceitam sinal (`signed`). */
function moneyFromField(texto, { signed = false } = {}) {
  const compacto = texto.trim().replace(/\s/g, '');
  const negativo = signed && compacto.startsWith('-');
  const digitos = negativo ? compacto.slice(1) : compacto;
  if (!FIELD_MONEY.test(digitos)) return null;
  const [inteiro, fracao = ''] = digitos.replace(/\./g, '').split(',');
  const normalizado = inteiro.replace(/^0+(?=\d)/, '');
  if (normalizado.length > 18) return null;
  const valor = `${normalizado}.${fracao.padEnd(2, '0')}`;
  return negativo && valor !== '0.00' ? `-${valor}` : valor;
}

/** O texto do contrato no campo: "-1234.50" vira "-1234,50". */
const moneyToField = (valor) => valor.replace('.', ',');

module.exports = { moneyFromField, moneyToField };
