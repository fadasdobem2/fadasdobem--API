'use strict';

/**
 * Telefone do cadastro (v706). Porta de `normalizeDuplicatePhone` (server/lilly/registration-format.mjs) e de
 * `clientWhatsAppText` (features/clientes/client-whatsapp-format.ts). Número local só casa com outro local: o DDD que falta
 * nunca é adivinhado. A API não grava o texto formatado por conta própria: o que a pessoa digita é o que vai (limite 45).
 */

function normalizeDuplicatePhone(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || !/^\+?[\d\s().-]+$/.test(text)) return '';
  const digits = text.replace(/\D/g, '');
  if (text.startsWith('+')) {
    if (digits.startsWith('55') && [10, 11].includes(digits.length)) return `local:${digits.slice(2)}`;
    return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : '';
  }
  if (digits.startsWith('00') && digits.length >= 12 && digits.length <= 17) return `+${digits.slice(2)}`;
  if (digits.startsWith('55') && [12, 13].includes(digits.length)) return `+${digits}`;
  if ([10, 11].includes(digits.length)) return `+55${digits}`;
  return [8, 9].includes(digits.length) ? `local:${digits}` : '';
}

/** Exibição e edição compartilhadas: preserva o DDI explícito e nunca adivinha o DDD. */
function clientWhatsAppText(value) {
  const text = value.trim().replace(/[()]/g, '').replace(/\s+/g, ' ');
  if (!text) return '';
  const digits = text.replace(/\D/g, '');
  if (text.startsWith('+') && !text.startsWith('+55')) return text;
  const national = digits.startsWith('55') && [12, 13].includes(digits.length)
    ? digits.slice(2)
    : text.startsWith('+') ? '' : digits;
  if ([8, 9].includes(national.length)) return `${national.slice(0, -4)}-${national.slice(-4)}`;
  if (![10, 11].includes(national.length)) return text;
  return `+55 ${national.slice(0, 2)} ${national.slice(2, -4)}-${national.slice(-4)}`;
}

module.exports = { clientWhatsAppText, normalizeDuplicatePhone };
