'use strict';

/**
 * Verificação de e-mail: emissão de token OTP por link, reenvio, consumo do
 * token e varredura de contas pendentes (R7).
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { sequelize, User, OTP } = require('../../models');
const AppError = require('../../utils/AppError');
const mailService = require('../../providers/mail/mail.service');
const { AUTH_CONFIG, AUTH_MESSAGES, normalizeEmail } = require('./auth.constants');
const { recordAuthSecurityAudit } = require('./auth.audit.helper');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** R7 — token OTP com id explícito (evita varreduras na BD). */
async function enqueueEmailVerification(userId, mail, reqMeta = {}) {
  await OTP.update(
    { consumed_at: new Date() },
    {
      where: {
        user_id: userId,
        purpose: AUTH_CONFIG.otpPurposeEmailVerify,
        consumed_at: null,
      },
    }
  );

  const secret = crypto.randomBytes(32).toString('base64url');
  const row = await OTP.create({
    user_id: userId,
    purpose: AUTH_CONFIG.otpPurposeEmailVerify,
    code: await bcrypt.hash(secret, AUTH_CONFIG.bcryptCostPassword),
    expires_at: new Date(Date.now() + AUTH_CONFIG.emailVerifyTtlHours * 3600 * 1000),
    attempts_count: 0,
    max_attempts: 5,
    delivery_channel: AUTH_CONFIG.otpDeliveryChannelEmail,
    ip_address_created: reqMeta.ip || null,
    user_agent_created: reqMeta.userAgent || null,
  });

  const payload = JSON.stringify({ otpId: row.id, s: secret });
  const encoded = Buffer.from(payload, 'utf8').toString('base64url');
  const query = `token=${encodeURIComponent(encoded)}`;
  const basePublic = `${process.env.API_PUBLIC_URL || ''}`.trim().replace(/\/+$/, '');
  const url = basePublic
    ? `${basePublic}/api/v1/auth/verify-email?${query}`
    : `http://localhost:${process.env.PORT || 3000}/api/v1/auth/verify-email?${query}`;
  void mailService.sendVerificationEmail(mail, url);
}

/** Marca contas há mais de 7 dias sem e-mail confirmado (R7). */
async function syncEmailPendingReviewFlags() {
  const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);
  const [affected] = await User.update(
    { email_pending_review: true },
    {
      where: {
        email_verified_at: null,
        email_pending_review: false,
        created_at: { [Op.lt]: cutoff },
      },
    }
  );
  return affected;
}

async function verifyEmailFromToken(tokenRaw, reqMeta = {}) {
  let parsed;
  try {
    const decoded = Buffer.from(`${tokenRaw || ''}`, 'base64url').toString('utf8');
    parsed = JSON.parse(decoded);
  } catch {
    throw new AppError(AUTH_MESSAGES.VERIFY_EMAIL_BAD_TOKEN, 400, null, true);
  }

  const row = await OTP.findOne({
    where: {
      id: parsed.otpId,
      purpose: AUTH_CONFIG.otpPurposeEmailVerify,
      consumed_at: null,
      expires_at: { [Op.gt]: new Date() },
    },
  });

  if (!row || !parsed.s) {
    throw new AppError(AUTH_MESSAGES.VERIFY_EMAIL_BAD_TOKEN, 400, null, true);
  }

  const ok = await bcrypt.compare(`${parsed.s}`, row.code);
  if (!ok) {
    throw new AppError(AUTH_MESSAGES.VERIFY_EMAIL_BAD_TOKEN, 400, null, true);
  }

  await sequelize.transaction(async (t) => {
    await row.update({ consumed_at: new Date() }, { transaction: t });
    await User.update(
      { email_verified_at: new Date(), email_pending_review: false },
      { where: { id: row.user_id }, transaction: t }
    );
  });

  await recordAuthSecurityAudit({
    action: 'AUTH_EMAIL_VERIFIED',
    userId: row.user_id,
    ip: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    metadata: { otp_id: row.id },
  });

  return { verificado: true, mensagem: AUTH_MESSAGES.VERIFY_EMAIL_SUCCESS };
}

async function resendVerificationEmail(accessUser, reqMeta = {}) {
  if (accessUser.email_verified_at) {
    return { enviado: false, motivo: 'already_verified' };
  }
  const mail = normalizeEmail(accessUser.email);
  await enqueueEmailVerification(accessUser.id, mail, reqMeta);
  return { enviado: true };
}

module.exports = {
  enqueueEmailVerification,
  syncEmailPendingReviewFlags,
  verifyEmailFromToken,
  resendVerificationEmail,
};
