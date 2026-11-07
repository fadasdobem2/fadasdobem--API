'use strict';

/**
 * Busca de cliente por telefone (v706). Porta de `clientPhoneMatches` de features/clientes/client-search-model.ts.
 * Regra: oito dígitos são o número local completo do legado, nunca um sufixo qualquer; o DDD informado estreita a busca
 * (sem DDD, duas clientes podem aparecer); o 9 inicial de oito para nove dígitos é aceito nos dois sentidos.
 * Substitui a regra da v608 (sufixo de 8 ou 9 dígitos contra o número guardado).
 */

function phoneParts(value) {
  let digits = value.replace(/\D/g, '');
  const explicitInternational = value.trim().startsWith('+');
  const brazil = digits.startsWith('55') && ((digits.length === 12 || digits.length === 13) || (explicitInternational && (digits.length === 10 || digits.length === 11)));
  if (brazil) digits = digits.slice(2);
  return { digits, foreign: explicitInternational && !brazil };
}

function clientPhoneMatches(query, stored) {
  if (!/^[+\d\s().-]+$/.test(query.trim())) return false;
  const q = phoneParts(query);
  const s = phoneParts(stored);
  if (!q.digits || !s.digits) return false;
  if (q.foreign || s.foreign) return q.digits === s.digits;
  if (![8, 9, 10, 11].includes(q.digits.length) || ![8, 9, 10, 11].includes(s.digits.length)) return false;
  const qDdd = q.digits.length >= 10 ? q.digits.slice(0, 2) : undefined;
  const sDdd = s.digits.length >= 10 ? s.digits.slice(0, 2) : undefined;
  if (qDdd && qDdd !== sDdd) return false;
  const qNumber = qDdd ? q.digits.slice(2) : q.digits;
  const sNumber = sDdd ? s.digits.slice(2) : s.digits;
  if (qNumber === sNumber) return true;
  return (qNumber.length === 8 && sNumber.length === 9 && sNumber[0] === '9' && sNumber.slice(1) === qNumber)
    || (qNumber.length === 9 && qNumber[0] === '9' && sNumber.length === 8 && qNumber.slice(1) === sNumber);
}

module.exports = { clientPhoneMatches };
