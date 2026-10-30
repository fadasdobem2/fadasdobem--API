'use strict';

/**
 * Validação e normalização de chave PIX por tipo (CPF, CNPJ, EMAIL, PHONE, EVP).
 * Sem rede: só formato (e dígitos verificadores de CPF/CNPJ).
 */

const PIX_TYPES = ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'];

const TYPE_ALIASES = {
  CPF: 'CPF',
  CNPJ: 'CNPJ',
  EMAIL: 'EMAIL',
  'E-MAIL': 'EMAIL',
  PHONE: 'PHONE',
  TELEFONE: 'PHONE',
  CELULAR: 'PHONE',
  EVP: 'EVP',
  ALEATORIA: 'EVP',
  'ALEATÓRIA': 'EVP',
  RANDOM: 'EVP',
};

function onlyDigits(s) {
  return `${s}`.replace(/\D/g, '');
}

function validCpf(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (let t = 9; t < 11; t += 1) {
    let sum = 0;
    for (let i = 0; i < t; i += 1) sum += Number(d[i]) * (t + 1 - i);
    const dv = ((sum * 10) % 11) % 10;
    if (dv !== Number(d[t])) return false;
  }
  return true;
}

function validCnpj(d) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(d[i]) * w[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** Celular/fixo BR: DDD (11..99) + 8 ou 9 dígitos, opcional +55. Normaliza para +55DDDNNNNNNNNN. */
function normalizePhone(raw) {
  let d = onlyDigits(raw);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  if (d.length === 11 && d[2] !== '9') return null;
  return `+55${d}`;
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeByType(type, raw) {
  const s = `${raw ?? ''}`.trim();
  switch (type) {
    case 'CPF': {
      const d = onlyDigits(s);
      return validCpf(d) ? d : null;
    }
    case 'CNPJ': {
      const d = onlyDigits(s);
      return validCnpj(d) ? d : null;
    }
    case 'EMAIL':
      return s.length <= 77 && EMAIL_RE.test(s) ? s.toLowerCase() : null;
    case 'PHONE':
      return normalizePhone(s);
    case 'EVP':
      return UUID_RE.test(s) ? s.toLowerCase() : null;
    default:
      return null;
  }
}

/** Sem tipo informado: infere pelo formato (ordem: EVP, EMAIL, CPF, CNPJ, PHONE). */
function inferType(raw) {
  for (const t of ['EVP', 'EMAIL', 'CPF', 'CNPJ', 'PHONE']) {
    if (normalizeByType(t, raw)) return t;
  }
  return null;
}

/**
 * @returns {{ type: string, key: string }} chave normalizada e tipo canônico.
 * @throws {Error} com `.code = 'PIX_INVALID'` e mensagem em PT-BR.
 */
function validatePixKey(typeRaw, keyRaw) {
  const fail = (msg) => {
    const e = new Error(msg);
    e.code = 'PIX_INVALID';
    return e;
  };
  const key = `${keyRaw ?? ''}`.trim();
  if (!key) throw fail('Informe `pix_key`.');

  const typeIn = `${typeRaw ?? ''}`.trim().toUpperCase();
  let type;
  if (typeIn) {
    type = TYPE_ALIASES[typeIn];
    if (!type) throw fail(`pix_type inválido. Use: ${PIX_TYPES.join(', ')}.`);
  } else {
    type = inferType(key);
    if (!type) throw fail('Chave PIX inválida: não reconhecida como CPF, CNPJ, e-mail, telefone ou chave aleatória.');
  }
  const norm = normalizeByType(type, key);
  if (!norm) throw fail(`Chave PIX inválida para o tipo ${type}.`);
  return { type, key: norm };
}

module.exports = { PIX_TYPES, validatePixKey, validCpf, validCnpj };
