'use strict';

const AppError = require('../../utils/AppError');
const { FORM_MIN_ELAPSED_MS, FORM_MAX_AGE_MS } = require('./trabalhe-conosco.constants');

function onlyDigits(v) {
  return `${v ?? ''}`.replace(/\D/g, '');
}

function honeypotFilled(body = {}) {
  const hp1 = `${body.autor_tarot ?? body.autorTarot ?? ''}`.trim();
  const hp2 = `${body.anos_exp ?? body.anosExp ?? ''}`.trim();
  return Boolean(hp1 || hp2);
}

function evaluateAntibot(body = {}, httpCtx = {}) {
  const reasons = [];
  const now = Date.now();

  if (honeypotFilled(body)) {
    reasons.push('honeypot');
  }

  const tsRaw = body.form_ts ?? body.formTs;
  const formTs = Number(tsRaw);
  if (!Number.isFinite(formTs) || formTs <= 0) {
    reasons.push('form_ts_ausente');
  } else {
    const elapsed = now - formTs;
    if (elapsed < FORM_MIN_ELAPSED_MS) reasons.push('form_ts_rapido');
    if (elapsed > FORM_MAX_AGE_MS) reasons.push('form_ts_expirado');
  }

  const quarentena = reasons.length > 0;
  return {
    quarentena,
    reasons,
    meta: {
      quarentena,
      antibot: {
        reasons,
        checked_at: new Date().toISOString(),
        ip: httpCtx.ip || null,
        user_agent: httpCtx.user_agent || null,
        form_ts: Number.isFinite(formTs) ? formTs : null,
      },
    },
  };
}

/** Resposta sempre “sucesso” para o cliente — quarentena é interna */
function publicSuccessMessage(quarentena) {
  return quarentena
    ? 'Candidatura recebida com sucesso.'
    : 'Candidatura recebida com sucesso.';
}

function assertMobileWhatsapp(raw, { required = false } = {}) {
  const digits = onlyDigits(raw);
  if (!digits) {
    if (required) throw new AppError('Informe WhatsApp com DDD.', 400, null, true);
    return null;
  }
  if (digits.length < 10 || digits.length > 13) {
    throw new AppError('WhatsApp inválido — use DDD + celular (10 a 13 dígitos).', 400, null, true);
  }
  const local = digits.length >= 11 ? digits.slice(-9) : digits.slice(-8);
  if (local.length === 9 && local[0] !== '9') {
    throw new AppError('WhatsApp deve ser celular (nono dígito 9).', 400, null, true);
  }
  return digits;
}

module.exports = {
  onlyDigits,
  honeypotFilled,
  evaluateAntibot,
  publicSuccessMessage,
  assertMobileWhatsapp,
};
