'use strict';

/**
 * Fluxo de senha: geração/entrega de OTP de redefinição (e-mail ou WhatsApp),
 * "esqueci a senha", redefinição e disparo administrativo de reset.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { sequelize, User, OTP, StaffProfile } = require('../../models');
const AppError = require('../../utils/AppError');
const mailService = require('../../providers/mail/mail.service');
const whatsappService = require('../../providers/whatsapp/whatsapp.service');
const {
  findActiveUserByPhoneDigits,
  tryNormalizeMobilePhone,
} = require('./auth.phone.helper');
const {
  AUTH_CONFIG,
  AUTH_MESSAGES,
  normalizeEmail,
  isValidEmailFormat,
  assertPasswordPolicy,
} = require('./auth.constants');
const { recordAuthSecurityAudit } = require('./auth.audit.helper');
const { revokeAllRefreshTokensForUser } = require('./auth.tokens.service');

function buildNumericOtpCode() {
  const n = AUTH_CONFIG.otpDigits;
  const max = 10 ** n;
  return crypto.randomInt(0, max).toString().padStart(n, '0');
}

async function invalidatePendingResetOtps(userId) {
  await OTP.update(
    { consumed_at: new Date() },
    {
      where: {
        user_id: userId,
        purpose: AUTH_CONFIG.otpPurposeResetPassword,
        consumed_at: null,
      },
    }
  );
}

async function createAndDeliverResetOtp(user, deliveryChannel, destination, reqMeta = {}) {
  await invalidatePendingResetOtps(user.id);

  const plainOtp = buildNumericOtpCode();
  const codeHash = await bcrypt.hash(plainOtp, AUTH_CONFIG.bcryptCostPassword);
  const expiresAt = new Date(Date.now() + AUTH_CONFIG.otpTtlMinutes * 60 * 1000);

  await OTP.create({
    user_id: user.id,
    purpose: AUTH_CONFIG.otpPurposeResetPassword,
    code: codeHash,
    expires_at: expiresAt,
    attempts_count: 0,
    max_attempts: AUTH_CONFIG.maxOtpAttempts,
    delivery_channel: deliveryChannel,
    ip_address_created: reqMeta.ip || null,
    user_agent_created: reqMeta.userAgent || null,
  });

  if (deliveryChannel === AUTH_CONFIG.otpDeliveryChannelWhatsapp) {
    const sendTo = `${user.phone || destination || ''}`.trim() || destination;
    void whatsappService.sendOtpWhatsapp(sendTo, plainOtp);
  } else {
    void mailService.sendOtpEmail(destination, plainOtp);
  }

  await recordAuthSecurityAudit({
    action: 'AUTH_FORGOT_PASSWORD_SEND',
    userId: user.id,
    ip: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    metadata: { delivery_channel: deliveryChannel },
  });
}

/**
 * Dispara o fluxo de redefinição de senha para uma conta (ação do admin sobre
 * um utilizador interno). Reutiliza o OTP de reset por e-mail.
 */
async function adminTriggerPasswordReset(userId, reqMeta = {}) {
  const user = await User.findByPk(userId);
  if (!user) {
    throw new AppError(AUTH_MESSAGES.USER_NOT_FOUND, 404, null, true);
  }
  const mail = normalizeEmail(user.email);
  await createAndDeliverResetOtp(user, AUTH_CONFIG.otpDeliveryChannelEmail, mail, reqMeta);
  return { sent: true, channel: 'email', email: mail };
}

/** POST /forgot-password — valida conta e envia OTP (email ou WhatsApp/celular). */
async function forgotPassword(body = {}, reqMeta = {}) {
  const mail = normalizeEmail(body.email);
  const phoneRaw = `${body.phone ?? body.whatsapp ?? body.celular ?? ''}`.trim();
  const phoneDigits = phoneRaw ? tryNormalizeMobilePhone(phoneRaw) : null;

  const hasEmailInput = Boolean(`${body.email ?? ''}`.trim());
  const hasPhoneInput = Boolean(phoneRaw);
  const hasEmail = Boolean(mail && isValidEmailFormat(mail));
  const hasPhone = Boolean(phoneDigits);

  if (!hasEmailInput && !hasPhoneInput) {
    throw new AppError(AUTH_MESSAGES.FORGOT_PASSWORD_IDENTIFIER_REQUIRED, 400, null, true);
  }

  let user = null;
  let deliveryChannel = null;
  let destination = null;

  if (hasPhoneInput && !hasEmailInput) {
    if (!hasPhone) {
      throw new AppError(AUTH_MESSAGES.FORGOT_PASSWORD_PHONE_INVALID, 400, null, true);
    }
    user = await findActiveUserByPhoneDigits(phoneDigits);
    deliveryChannel = AUTH_CONFIG.otpDeliveryChannelWhatsapp;
    destination = phoneDigits;
  } else if (hasEmailInput && !hasPhoneInput) {
    if (!hasEmail) {
      throw new AppError(AUTH_MESSAGES.EMAIL_INVALID_FORMAT, 400, null, true);
    }
    user = await User.findOne({ where: { email: mail } });
    deliveryChannel = AUTH_CONFIG.otpDeliveryChannelEmail;
    destination = mail;
  } else {
    const preferPhone =
      `${body.channel ?? body.canal ?? ''}`.trim().toLowerCase() === 'whatsapp' ||
      `${body.channel ?? body.canal ?? ''}`.trim().toLowerCase() === 'phone' ||
      `${body.prefer ?? ''}`.trim().toLowerCase() === 'phone';

    if (preferPhone) {
      if (!hasPhone) {
        throw new AppError(AUTH_MESSAGES.FORGOT_PASSWORD_PHONE_INVALID, 400, null, true);
      }
      user = await findActiveUserByPhoneDigits(phoneDigits);
      deliveryChannel = AUTH_CONFIG.otpDeliveryChannelWhatsapp;
      destination = phoneDigits;
    } else {
      if (!hasEmail) {
        throw new AppError(AUTH_MESSAGES.EMAIL_INVALID_FORMAT, 400, null, true);
      }
      user = await User.findOne({ where: { email: mail } });
      deliveryChannel = AUTH_CONFIG.otpDeliveryChannelEmail;
      destination = mail;
    }
  }

  if (!user || !user.is_active || user.blocked_at) {
    const msg =
      deliveryChannel === AUTH_CONFIG.otpDeliveryChannelWhatsapp
        ? AUTH_MESSAGES.FORGOT_PASSWORD_ACCOUNT_NOT_FOUND_PHONE
        : AUTH_MESSAGES.FORGOT_PASSWORD_ACCOUNT_NOT_FOUND_EMAIL;
    throw new AppError(msg, 404, null, true);
  }

  await createAndDeliverResetOtp(user, deliveryChannel, destination, reqMeta);

  return {
    enviado: true,
    conta_encontrada: true,
    canal: deliveryChannel === AUTH_CONFIG.otpDeliveryChannelWhatsapp ? 'whatsapp' : 'email',
  };
}

/** POST /reset-password — identificador: email ou phone/whatsapp. */
async function resetPassword(body = {}, reqMeta = {}) {
  const mail = normalizeEmail(body.email);
  const phoneDigits = tryNormalizeMobilePhone(body.phone ?? body.whatsapp ?? body.celular);
  const plainOtp = `${body.otp ?? ''}`.trim();
  assertPasswordPolicy(body.new_password);

  const hasEmail = Boolean(mail && isValidEmailFormat(mail));
  const hasPhone = Boolean(phoneDigits);

  if ((!hasEmail && !hasPhone) || !plainOtp) {
    throw new AppError(AUTH_MESSAGES.RESET_INSUFFICIENT_DATA, 400, null, true);
  }

  let user = null;
  if (hasPhone && !hasEmail) {
    user = await findActiveUserByPhoneDigits(phoneDigits);
  } else if (hasEmail && !hasPhone) {
    user = await User.findOne({ where: { email: mail } });
  } else {
    user = await findActiveUserByPhoneDigits(phoneDigits);
    if (!user) {
      user = await User.findOne({ where: { email: mail } });
    }
  }

  if (!user) {
    throw new AppError(AUTH_MESSAGES.RESET_CODE_INVALID_OR_EXPIRED, 400, null, true);
  }
  if (!user.is_active || user.blocked_at) {
    throw new AppError(AUTH_MESSAGES.RESET_CODE_INVALID_OR_EXPIRED, 400, null, true);
  }

  const otpRow = await OTP.findOne({
    where: {
      user_id: user.id,
      purpose: AUTH_CONFIG.otpPurposeResetPassword,
      consumed_at: null,
      expires_at: { [Op.gt]: new Date() },
    },
    order: [['created_at', 'DESC']],
  });

  if (!otpRow) {
    throw new AppError(AUTH_MESSAGES.RESET_CODE_INVALID_OR_EXPIRED, 400, null, true);
  }

  if (otpRow.attempts_count >= otpRow.max_attempts) {
    throw new AppError(AUTH_MESSAGES.RESET_OTP_MAX_ATTEMPTS, 429, null, true);
  }

  const match = await bcrypt.compare(plainOtp, otpRow.code);
  if (!match) {
    await otpRow.increment('attempts_count');
    await otpRow.reload();
    if (otpRow.attempts_count >= otpRow.max_attempts) {
      throw new AppError(AUTH_MESSAGES.RESET_OTP_MAX_ATTEMPTS, 429, null, true);
    }
    throw new AppError(AUTH_MESSAGES.RESET_CODE_INVALID_OR_EXPIRED, 400, null, true);
  }

  const password_hash = await bcrypt.hash(body.new_password, AUTH_CONFIG.bcryptCostPassword);
  await sequelize.transaction(async (t) => {
    await user.update({ password_hash }, { transaction: t });
    await otpRow.update({ consumed_at: new Date() }, { transaction: t });
    // Limpa a exigência de troca de senha (força-troca do admin) ao redefinir.
    await StaffProfile.update(
      { must_change_password: false },
      { where: { user_id: user.id }, transaction: t }
    );
  });

  await revokeAllRefreshTokensForUser(user.id);

  await recordAuthSecurityAudit({
    action: 'AUTH_PASSWORD_RESET_SUCCESS',
    userId: user.id,
    ip: reqMeta.ip,
    userAgent: reqMeta.userAgent,
  });

  return { redefinido: true };
}

module.exports = {
  createAndDeliverResetOtp,
  invalidatePendingResetOtps,
  adminTriggerPasswordReset,
  forgotPassword,
  resetPassword,
};
