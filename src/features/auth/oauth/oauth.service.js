'use strict';

const { UniqueConstraintError } = require('sequelize');
const { sequelize, User, Client, OAuthAccount } = require('../../../models');
const AppError = require('../../../utils/AppError');
const {
  AUTH_CONFIG,
  AUTH_MESSAGES,
  normalizeEmail,
  assertEmailFormat,
} = require('../auth.constants');
const { isDisposableEmailAddress } = require('../../../config/disposableEmails.config');
const { recordAuthSecurityAudit } = require('../auth.audit.helper');
const {
  issueTokenPairForUser,
  sanitizeUserRecord,
  recordWebLoginDevice,
} = require('../auth.service');

function userNeedsOAuthProfile(user) {
  if (!user) return true;
  if (!user.accepted_terms_at || !user.accepted_terms_version) return true;
  const client = user.client_profile;
  if (!client?.tratar_por || !client?.data_nascimento) return true;
  return false;
}

function assertOAuthEmail(email) {
  assertEmailFormat(email);
  const mail = normalizeEmail(email);
  if (isDisposableEmailAddress(mail)) {
    throw new AppError(AUTH_MESSAGES.EMAIL_DISPOSABLE, 400, null, true);
  }
  return mail;
}

async function findUserByOAuth(providerDb, providerUserId) {
  const link = await OAuthAccount.findOne({
    where: { provider: providerDb, provider_user_id: `${providerUserId}` },
    include: [
      {
        model: User,
        as: 'user',
        required: true,
        include: [{ model: Client, as: 'client_profile', required: false }],
      },
    ],
  });
  return link?.user || null;
}

async function assertUserCanLogin(user) {
  if (!user) {
    throw new AppError(AUTH_MESSAGES.USER_NOT_FOUND, 404, null, true);
  }
  if (!user.is_active || user.blocked_at) {
    throw new AppError(AUTH_MESSAGES.ACCOUNT_UNAVAILABLE_LOGIN, 403, null, true);
  }
  if (`${user.role || ''}` !== AUTH_CONFIG.roleClienteNoRegistro) {
    throw new AppError(
      'Login social disponível apenas para contas de cliente.',
      403,
      { code: 'OAUTH_ROLE_NOT_ALLOWED' },
      true
    );
  }
}

async function upsertOAuthLink(userId, providerDb, providerUserId, profilePayload) {
  const existing = await OAuthAccount.findOne({
    where: { provider: providerDb, provider_user_id: `${providerUserId}` },
  });
  if (existing) {
    await existing.update({ profile_payload: profilePayload });
    return existing;
  }
  return OAuthAccount.create({
    user_id: userId,
    provider: providerDb,
    provider_user_id: `${providerUserId}`.slice(0, 191),
    profile_payload: profilePayload,
  });
}

/**
 * Resolve login/registo via OAuth.
 * @returns {{ user, tokens, isNew: boolean, needsProfile: boolean }}
 */
async function loginOrRegisterWithOAuth(
  { providerDb, providerUserId, email, emailVerified, displayName, profilePayload },
  reqMeta = {}
) {
  let user = await findUserByOAuth(providerDb, providerUserId);

  if (user) {
    await assertUserCanLogin(user);
    await upsertOAuthLink(user.id, providerDb, providerUserId, profilePayload);
    await user.update({ last_login_at: new Date() });
    if (emailVerified && !user.email_verified_at) {
      await user.update({ email_verified_at: new Date() });
    }
    await recordWebLoginDevice(user.id, reqMeta.ip, reqMeta.userAgent);
    await recordAuthSecurityAudit({
      action: 'AUTH_OAUTH_LOGIN_SUCCESS',
      userId: user.id,
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      metadata: { provider: providerDb, is_new: false },
    });
    const tokens = await issueTokenPairForUser(user);
    return {
      user,
      tokens,
      isNew: false,
      needsProfile: userNeedsOAuthProfile(user),
    };
  }

  if (!email) {
    throw new AppError(
      'O provedor não devolveu e-mail. Autorize o acesso ao e-mail ou use cadastro com senha.',
      400,
      { code: 'OAUTH_EMAIL_MISSING' },
      true
    );
  }

  const mail = assertOAuthEmail(email);

  const byEmail = await User.findOne({
    where: { email: mail },
    include: [{ model: Client, as: 'client_profile', required: false }],
  });

  if (byEmail) {
    if (byEmail.password_hash) {
      throw new AppError(
        'Este e-mail já possui cadastro com senha. Entre com email e senha.',
        409,
        { code: 'OAUTH_EMAIL_PASSWORD_EXISTS' },
        true
      );
    }
    user = byEmail;
    await assertUserCanLogin(user);
    await upsertOAuthLink(user.id, providerDb, providerUserId, profilePayload);
  } else {
    let createdUser;
    try {
      await sequelize.transaction(async (t) => {
        createdUser = await User.create(
          {
            email: mail,
            password_hash: null,
            role: AUTH_CONFIG.roleClienteNoRegistro,
            email_verified_at: emailVerified ? new Date() : null,
            email_pending_review: false,
            accepted_terms_version: null,
            accepted_terms_at: null,
            onboarding_step: AUTH_CONFIG.onboardingStepAfterRegister,
            is_active: true,
            profile_avatar_url: profilePayload?.picture || null,
          },
          { transaction: t }
        );
        await Client.create(
          {
            user_id: createdUser.id,
            nome_completo: displayName ? `${displayName}`.slice(0, 160) : null,
            nome: displayName ? `${displayName}`.slice(0, 160) : null,
          },
          { transaction: t }
        );
        await OAuthAccount.create(
          {
            user_id: createdUser.id,
            provider: providerDb,
            provider_user_id: `${providerUserId}`.slice(0, 191),
            profile_payload: profilePayload,
          },
          { transaction: t }
        );
      });
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        throw new AppError(AUTH_MESSAGES.EMAIL_ALREADY_REGISTERED, 409, null, true);
      }
      throw err;
    }

    user = await User.findByPk(createdUser.id, {
      include: [{ model: Client, as: 'client_profile', required: false }],
    });

    await recordAuthSecurityAudit({
      action: 'AUTH_OAUTH_REGISTER_SUCCESS',
      userId: user.id,
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      metadata: { provider: providerDb },
    });
  }

  await user.update({ last_login_at: new Date() });
  await recordWebLoginDevice(user.id, reqMeta.ip, reqMeta.userAgent);

  const tokens = await issueTokenPairForUser(user);
  return {
    user,
    tokens,
    isNew: !byEmail,
    needsProfile: userNeedsOAuthProfile(user),
  };
}

async function completeOAuthProfile(userId, body = {}) {
  const user = await User.findByPk(userId, {
    include: [{ model: Client, as: 'client_profile', required: false }],
  });
  if (!user) throw new AppError(AUTH_MESSAGES.USER_NOT_FOUND, 404, null, true);
  if (user.role !== AUTH_CONFIG.roleClienteNoRegistro || !user.client_profile) {
    throw new AppError(AUTH_MESSAGES.PROFILE_NOT_CLIENT_EDITABLE, 403, null, true);
  }

  const tratarPor = `${body.tratar_por ?? body.tratarPor ?? ''}`.trim();
  const dataNasc = `${body.data_nascimento ?? body.dataNascimento ?? ''}`.trim();
  const termsVersion = `${body.accepted_terms_version ?? body.acceptedTermsVersion ?? ''}`.trim();

  if (!tratarPor) {
    throw new AppError('Informe como quer ser chamada.', 400, null, true);
  }
  if (!dataNasc) {
    throw new AppError('Informe a data de nascimento.', 400, null, true);
  }
  if (!termsVersion) {
    throw new AppError(AUTH_MESSAGES.TERMS_ACCEPTANCE_REQUIRED, 400, null, true);
  }

  await sequelize.transaction(async (t) => {
    await user.client_profile.update(
      {
        tratar_por: tratarPor.slice(0, AUTH_CONFIG.profileTratarPorMaxLength),
        data_nascimento: dataNasc,
      },
      { transaction: t }
    );
    await user.update(
      {
        accepted_terms_version: termsVersion,
        accepted_terms_at: new Date(),
      },
      { transaction: t }
    );
  });

  await user.reload({
    include: [{ model: Client, as: 'client_profile', required: false }],
  });

  return { usuario: sanitizeUserRecord(user), needsProfile: false };
}

module.exports = {
  loginOrRegisterWithOAuth,
  completeOAuthProfile,
  userNeedsOAuthProfile,
};
