'use strict';

const evolutionClient = require('../evolution/evolution.client');

function resolveEvolutionInstance() {
  return `${process.env.EVOLUTION_WHATSAPP_INSTANCE_NAME || process.env.CHATWOOT_EVOLUTION_INSTANCE_NAME || process.env.EVOLUTION_INSTANCE_NAME || ''}`.trim();
}

/** BR móvel — garante DDI 55 para Evolution. */
function toWhatsappE164Digits(raw) {
  const d = evolutionClient.normalizeWhatsappNumber(raw);
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function buildOtpMessage(code, expiresIn) {
  const safeCode = `${code ?? ''}`.trim();
  const safeExpires = `${expiresIn ?? '10 minutos'}`.trim();
  return (
    `Fadas do Bem ✦\n\n` +
    `Seu código para redefinir a senha: *${safeCode}*\n\n` +
    `Válido por ${safeExpires}. Se você não solicitou, ignore esta mensagem.`
  );
}

/**
 * OTP de recuperação via WhatsApp (Evolution) — falhas apenas em log.
 * @param {string} toDigits
 * @param {string} code
 */
async function sendOtpWhatsapp(toDigits, code) {
  try {
    const instance = resolveEvolutionInstance();
    if (!instance) {
      console.error('[whatsapp.service] Envio OTP não configurado — defina EVOLUTION_WHATSAPP_INSTANCE_NAME.');
      return;
    }

    const number = toWhatsappE164Digits(toDigits);
    if (!number) {
      console.error('[whatsapp.service] Destinatário WhatsApp vazio.');
      return;
    }

    await evolutionClient.sendMessageText(instance, {
      number,
      text: buildOtpMessage(code, '10 minutos'),
    });
  } catch (err) {
    console.error('[whatsapp.service] Falha ao enviar OTP WhatsApp:', err?.response?.data || err?.message || err);
  }
}

module.exports = {
  resolveEvolutionInstance,
  toWhatsappE164Digits,
  sendOtpWhatsapp,
};
