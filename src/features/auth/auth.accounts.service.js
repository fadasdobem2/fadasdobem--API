'use strict';

/**
 * Criação de contas: registro público (`/register`) e conversão de lead
 * Chatwoot em conta `User` + `Client` (transacional).
 */
const bcrypt = require('bcryptjs');
const { UniqueConstraintError } = require('sequelize');
const { sequelize, User, Client, Lead, Session } = require('../../models');
const AppError = require('../../utils/AppError');
const mailService = require('../../providers/mail/mail.service');
const {
  AUTH_CONFIG,
  AUTH_MESSAGES,
  normalizeEmail,
  assertEmailFormat,
  assertPasswordPolicy,
} = require('./auth.constants');
const { isDisposableEmailAddress } = require('../../config/disposableEmails.config');
const { recordAuthSecurityAudit } = require('./auth.audit.helper');
const { issueTokenPairForUser, sanitizeUserRecord } = require('./auth.tokens.service');
const { enqueueEmailVerification } = require('./auth.email-verification.service');

/** POST /register */
async function register({ email, password, accepted_terms_version }, reqMeta = {}) {
  assertEmailFormat(email);
  const mail = normalizeEmail(email);

  if (isDisposableEmailAddress(mail)) {
    throw new AppError(AUTH_MESSAGES.EMAIL_DISPOSABLE, 400, null, true);
  }

  assertPasswordPolicy(password);

  if (accepted_terms_version === undefined || accepted_terms_version === null) {
    throw new AppError(AUTH_MESSAGES.TERMS_ACCEPTANCE_REQUIRED, 400, null, true);
  }
  const terms = `${accepted_terms_version}`.trim();
  if (!terms) {
    throw new AppError(AUTH_MESSAGES.TERMS_ACCEPTANCE_REQUIRED, 400, null, true);
  }

  const exists = await User.findOne({ where: { email: mail } });
  if (exists) {
    throw new AppError(AUTH_MESSAGES.EMAIL_ALREADY_REGISTERED, 409, null, true);
  }

  const password_hash = await bcrypt.hash(password, AUTH_CONFIG.bcryptCostPassword);

  let user;
  try {
    await sequelize.transaction(async (t) => {
      user = await User.create(
        {
          email: mail,
          password_hash,
          role: AUTH_CONFIG.roleClienteNoRegistro,
          email_verified_at: null,
          email_pending_review: false,
          accepted_terms_version: terms,
          accepted_terms_at: new Date(),
          onboarding_step: AUTH_CONFIG.onboardingStepAfterRegister,
          is_active: true,
        },
        { transaction: t }
      );

      await Client.create(
        {
          user_id: user.id,
        },
        { transaction: t }
      );
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError || err.name === 'SequelizeUniqueConstraintError') {
      throw new AppError(AUTH_MESSAGES.EMAIL_ALREADY_REGISTERED, 409, null, true);
    }
    throw err;
  }

  user = await User.findByPk(user.id, {
    include: [{ model: Client, as: 'client_profile', required: false }],
  });

  await recordAuthSecurityAudit({
    action: 'AUTH_REGISTER_SUCCESS',
    userId: user.id,
    ip: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    metadata: { terms_version: terms },
  });

  void mailService.sendWelcomeEmail(mail);
  void enqueueEmailVerification(user.id, mail, reqMeta);

  const tokens = await issueTokenPairForUser(user);
  return {
    ...tokens,
    usuario: sanitizeUserRecord(user),
  };
}

/**
 * Converte um lead Chatwoot em conta `User` + `Client` (transacção atómica).
 * O histórico de mensagens permanece no Chatwoot; o vínculo operacional é reposto em `users.chatwoot_*`.
 * Se existir `Session` com o mesmo `chatwoot_conversation_id` (cenários futuros), o `client_id` é actualizado.
 *
 * @param {string} leadId
 * @param {{
 *   email: string,
 *   password: string,
 *   accepted_terms_version: string,
 *   nome?: string|null,
 *   nome_completo?: string|null,
 *   data_nascimento?: string|null,
 *   phone?: string|null,
 * }} userData
 */
async function convertLeadToClient(leadId, userData, reqMeta = {}) {
  assertEmailFormat(userData.email);
  const mail = normalizeEmail(userData.email);

  if (isDisposableEmailAddress(mail)) {
    throw new AppError(AUTH_MESSAGES.EMAIL_DISPOSABLE, 400, null, true);
  }

  assertPasswordPolicy(userData.password);

  if (userData.accepted_terms_version === undefined || userData.accepted_terms_version === null) {
    throw new AppError(AUTH_MESSAGES.TERMS_ACCEPTANCE_REQUIRED, 400, null, true);
  }
  const terms = `${userData.accepted_terms_version}`.trim();
  if (!terms) {
    throw new AppError(AUTH_MESSAGES.TERMS_ACCEPTANCE_REQUIRED, 400, null, true);
  }

  const emailTaken = await User.findOne({ where: { email: mail } });
  if (emailTaken) {
    throw new AppError(AUTH_MESSAGES.EMAIL_ALREADY_REGISTERED, 409, null, true);
  }

  const password_hash = await bcrypt.hash(userData.password, AUTH_CONFIG.bcryptCostPassword);

  let user;
  let leadRef;

  try {
    await sequelize.transaction(async (t) => {
      const lead = await Lead.findByPk(leadId, { transaction: t });
      if (!lead) {
        throw new AppError(AUTH_MESSAGES.LEAD_NOT_FOUND, 404, null, true);
      }
      if (lead.status === 'CONVERTED') {
        throw new AppError(AUTH_MESSAGES.LEAD_ALREADY_CONVERTED, 409, null, true);
      }

      const existingUserForContact = await User.findOne({
        where: { chatwoot_contact_id: lead.chatwoot_contact_id },
        transaction: t,
      });
      if (existingUserForContact) {
        throw new AppError(AUTH_MESSAGES.CHATWOOT_CONTACT_USER_EXISTS, 409, null, true);
      }

      const pixNote =
        lead.pix_key_suggested && `${lead.pix_key_suggested}`.trim()
          ? `PIX (rascunho lead): ${`${lead.pix_key_suggested}`.trim()}`
          : null;

      user = await User.create(
        {
          email: mail,
          password_hash,
          role: AUTH_CONFIG.roleClienteNoRegistro,
          email_verified_at: null,
          email_pending_review: false,
          accepted_terms_version: terms,
          accepted_terms_at: new Date(),
          onboarding_step: AUTH_CONFIG.onboardingStepAfterRegister,
          is_active: true,
          phone: userData.phone != null && `${userData.phone}`.trim() ? `${userData.phone}`.trim() : lead.phone,
          chatwoot_contact_id: lead.chatwoot_contact_id,
          chatwoot_conversation_id: lead.chatwoot_conversation_id,
          openai_thread_id: lead.openai_thread_id || null,
        },
        { transaction: t }
      );

      const nomeFullCandidate = (() => {
        if (userData.nome_completo != null && `${userData.nome_completo}`.trim()) {
          return `${userData.nome_completo}`.trim().slice(0, AUTH_CONFIG.profileNomeMaxLength);
        }
        if (userData.nome != null && `${userData.nome}`.trim()) {
          return `${userData.nome}`.trim().slice(0, AUTH_CONFIG.profileNomeMaxLength);
        }
        return '';
      })();

      let dataNasc = null;
      if (userData.data_nascimento != null && `${userData.data_nascimento}`.trim() !== '') {
        dataNasc = `${userData.data_nascimento}`.trim();
      }

      const clientProfile = await Client.create(
        {
          user_id: user.id,
          nome_completo: nomeFullCandidate || null,
          nome: nomeFullCandidate || null,
          data_nascimento: dataNasc,
          internal_notes: pixNote,
        },
        { transaction: t }
      );

      await lead.update(
        {
          status: 'CONVERTED',
          last_interaction_at: new Date(),
        },
        { transaction: t }
      );

      leadRef = lead;

      const convId = `${lead.chatwoot_conversation_id ?? ''}`.trim();
      if (convId) {
        await Session.update(
          { client_id: clientProfile.id },
          {
            where: { chatwoot_conversation_id: convId },
            transaction: t,
          }
        );
      }

      // eslint-disable-next-line global-require, import/no-dynamic-require
      const paymentsService = require('../payments/payments.service');
      await paymentsService.reconcileLeadFsmPaymentsAfterConversion(lead.id, clientProfile.id, t);
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError || err.name === 'SequelizeUniqueConstraintError') {
      throw new AppError(AUTH_MESSAGES.EMAIL_ALREADY_REGISTERED, 409, null, true);
    }
    throw err;
  }

  user = await User.findByPk(user.id, {
    include: [{ model: Client, as: 'client_profile', required: false }],
  });

  await recordAuthSecurityAudit({
    action: 'AUTH_LEAD_CONVERTED',
    userId: user.id,
    ip: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    metadata: {
      lead_id: leadRef?.id ?? null,
      chatwoot_contact_id: leadRef?.chatwoot_contact_id ?? null,
      conversation_id: leadRef?.chatwoot_conversation_id ?? null,
    },
  });

  void mailService.sendWelcomeEmail(mail);
  void enqueueEmailVerification(user.id, mail, reqMeta);

  const tokens = await issueTokenPairForUser(user);
  return {
    ...tokens,
    usuario: sanitizeUserRecord(user),
  };
}

module.exports = { register, convertLeadToClient };
