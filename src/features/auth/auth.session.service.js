'use strict';

/**
 * Sessão e perfil: login (conta regular e temporária), refresh, logout,
 * `/me`, edição de perfil e preview/aceite de convite de staff.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const {
  User,
  Client,
  Specialist,
  RefreshToken,
  AccountRecoveryRequest,
  TemporaryUser,
  TemporaryClient,
} = require('../../models');
const { assertJwtSecretsLoaded, jwtVerifyOptions } = require('../../config/auth.config');
const AppError = require('../../utils/AppError');
const { AUTH_CONFIG, AUTH_MESSAGES, normalizeEmail, assertEmailFormat } = require('./auth.constants');
const { recordAuthSecurityAudit } = require('./auth.audit.helper');
const staffInviteService = require('../../rbac/staff-invite.service');
const {
  issueTokenPairForUser,
  sanitizeUserRecord,
  recordWebLoginDevice,
  revokeRefreshByJti,
  attachRbacIfStaff,
} = require('./auth.tokens.service');

/** POST /login */
async function login({ email, password }, reqMeta = {}) {
  assertEmailFormat(email);
  const mail = normalizeEmail(email);

  // ── Tenta conta regular primeiro ──────────────────────────────────────────
  const regularUser = await User.findOne({
    where: { email: mail },
    include: [{ model: Client, as: 'client_profile', required: false }],
  });

  if (regularUser) {
    if (!regularUser.password_hash) {
      await recordAuthSecurityAudit({ action: 'AUTH_LOGIN_FAILURE', userId: regularUser.id, ip: reqMeta.ip, userAgent: reqMeta.userAgent, metadata: { reason: 'no_password' } });
      throw new AppError(AUTH_MESSAGES.LOGIN_CREDENTIALS_GENERIC, 401, null, true);
    }
    if (!regularUser.is_active || regularUser.blocked_at) {
      await recordAuthSecurityAudit({ action: 'AUTH_LOGIN_FAILURE', userId: regularUser.id, ip: reqMeta.ip, userAgent: reqMeta.userAgent, metadata: { reason: 'inactive_or_blocked' } });
      throw new AppError(AUTH_MESSAGES.ACCOUNT_UNAVAILABLE_LOGIN, 403, null, true);
    }
    const ok = await bcrypt.compare(`${password ?? ''}`, regularUser.password_hash);
    if (!ok) {
      await recordAuthSecurityAudit({ action: 'AUTH_LOGIN_FAILURE', userId: regularUser.id, ip: reqMeta.ip, userAgent: reqMeta.userAgent, metadata: { reason: 'bad_password' } });
      throw new AppError(AUTH_MESSAGES.LOGIN_CREDENTIALS_GENERIC, 401, null, true);
    }
    if (`${regularUser.role || ''}` === 'TAROLOGA') {
      const specProfile = await Specialist.findOne({
        where: { user_id: regularUser.id },
        attributes: ['id', 'registration_approval_status'],
      });
      if (specProfile?.registration_approval_status === 'REJECTED') {
        await recordAuthSecurityAudit({
          action: 'AUTH_LOGIN_FAILURE',
          userId: regularUser.id,
          ip: reqMeta.ip,
          userAgent: reqMeta.userAgent,
          metadata: { reason: 'tarologa_rejected' },
        });
        throw new AppError(AUTH_MESSAGES.ACCOUNT_UNAVAILABLE_LOGIN, 403, null, true);
      }
    }
    await regularUser.update({ last_login_at: new Date() });
    await recordWebLoginDevice(regularUser.id, reqMeta.ip, reqMeta.userAgent);
    await recordAuthSecurityAudit({ action: 'AUTH_LOGIN_SUCCESS', userId: regularUser.id, ip: reqMeta.ip, userAgent: reqMeta.userAgent });
    const tokens = await issueTokenPairForUser(regularUser, { accountType: 'user' });
    const rbacExtra = await attachRbacIfStaff(regularUser);
    return { ...tokens, usuario: sanitizeUserRecord(regularUser), recovery_request: null, ...rbacExtra };
  }

  // ── Tenta conta temporária ─────────────────────────────────────────────────
  const tempUser = await TemporaryUser.findOne({
    where: { email: mail },
    include: [{ model: TemporaryClient, as: 'client_profile', required: false }],
  });

  if (!tempUser) {
    await recordAuthSecurityAudit({ action: 'AUTH_LOGIN_FAILURE', userId: null, ip: reqMeta.ip, userAgent: reqMeta.userAgent, metadata: { reason: 'unknown_user' } });
    throw new AppError(AUTH_MESSAGES.LOGIN_CREDENTIALS_GENERIC, 401, null, true);
  }

  if (!tempUser.is_active || tempUser.blocked_at) {
    await recordAuthSecurityAudit({ action: 'AUTH_LOGIN_FAILURE', userId: tempUser.id, ip: reqMeta.ip, userAgent: reqMeta.userAgent, metadata: { reason: 'temp_inactive_or_blocked' } });
    throw new AppError(AUTH_MESSAGES.ACCOUNT_UNAVAILABLE_LOGIN, 403, null, true);
  }

  const okTemp = await bcrypt.compare(`${password ?? ''}`, tempUser.password_hash);
  if (!okTemp) {
    await recordAuthSecurityAudit({ action: 'AUTH_LOGIN_FAILURE', userId: tempUser.id, ip: reqMeta.ip, userAgent: reqMeta.userAgent, metadata: { reason: 'bad_password_temp' } });
    throw new AppError(AUTH_MESSAGES.LOGIN_CREDENTIALS_GENERIC, 401, null, true);
  }

  // Verifica estágio da solicitação de recuperação
  const recoveryRequest = await AccountRecoveryRequest.findOne({
    where: { temp_account_id: tempUser.id, deleted_at: null },
    order: [['created_at', 'DESC']],
    attributes: ['id', 'sync_stage'],
  });

  if (recoveryRequest?.sync_stage === 'MERGED') {
    await recordAuthSecurityAudit({ action: 'AUTH_LOGIN_FAILURE', userId: tempUser.id, ip: reqMeta.ip, userAgent: reqMeta.userAgent, metadata: { reason: 'recovery_merged' } });
    throw new AppError(
      'Esta conta temporária foi sincronizada. Por favor, entre com o e-mail da sua conta original.',
      403,
      { recovery_stage: 'MERGED', recovery_request_id: recoveryRequest.id },
      true
    );
  }

  if (recoveryRequest?.sync_stage === 'CANCELLED') {
    await recordAuthSecurityAudit({ action: 'AUTH_LOGIN_FAILURE', userId: tempUser.id, ip: reqMeta.ip, userAgent: reqMeta.userAgent, metadata: { reason: 'recovery_cancelled' } });
    throw new AppError(
      'A solicitação de recuperação desta conta foi cancelada. Entre em contato com o suporte.',
      403,
      { recovery_stage: 'CANCELLED', recovery_request_id: recoveryRequest.id },
      true
    );
  }

  await tempUser.update({ last_login_at: new Date() });
  await recordAuthSecurityAudit({ action: 'AUTH_LOGIN_SUCCESS', userId: tempUser.id, ip: reqMeta.ip, userAgent: reqMeta.userAgent, metadata: { account_type: 'temp', recovery_stage: recoveryRequest?.sync_stage } });

  const tokens = await issueTokenPairForUser(tempUser, { accountType: 'temp' });
  return {
    ...tokens,
    usuario: sanitizeUserRecord(tempUser),
    recovery_request: recoveryRequest
      ? { id: recoveryRequest.id, sync_stage: recoveryRequest.sync_stage }
      : null,
  };
}

/** POST /refresh-token */
async function refreshToken({ refresh_token }) {
  const raw = `${refresh_token ?? ''}`.trim();
  if (!raw) {
    throw new AppError(AUTH_MESSAGES.REFRESH_TOKEN_REQUIRED, 400, null, true);
  }

  assertJwtSecretsLoaded();
  let payload;
  try {
    payload = jwt.verify(raw, process.env.JWT_REFRESH_SECRET, jwtVerifyOptions());
  } catch (_) {
    throw new AppError(AUTH_MESSAGES.REFRESH_TOKEN_INVALID_OR_EXPIRED, 401, null, true);
  }

  if (payload.token_use !== 'refresh' || !payload.jti) {
    throw new AppError(AUTH_MESSAGES.REFRESH_TOKEN_MALFORMED, 401, null, true);
  }

  const row = await RefreshToken.findOne({
    where: {
      jti: payload.jti,
      user_id: payload.sub,
      revoked_at: null,
      expires_at: { [Op.gt]: new Date() },
    },
  });

  if (!row) {
    throw new AppError(AUTH_MESSAGES.REFRESH_SESSION_INVALID, 401, null, true);
  }

  await row.update({ revoked_at: new Date() });

  const user = await User.findByPk(payload.sub, {
    include: [{ model: Client, as: 'client_profile', required: false }],
  });

  if (!user || !user.is_active || user.blocked_at) {
    throw new AppError(AUTH_MESSAGES.ACCOUNT_UNAVAILABLE_REFRESH, 403, null, true);
  }

  if (`${user.role || ''}` === 'TAROLOGA') {
    const specProfile = await Specialist.findOne({
      where: { user_id: user.id },
      attributes: ['id', 'registration_approval_status'],
    });
    if (specProfile?.registration_approval_status === 'REJECTED') {
      throw new AppError(AUTH_MESSAGES.ACCOUNT_UNAVAILABLE_REFRESH, 403, null, true);
    }
  }

  const tokens = await issueTokenPairForUser(user);
  return {
    ...tokens,
    usuario: sanitizeUserRecord(user),
  };
}

/** POST /logout — exige access válido + corpo com refresh. */
async function logout({ refresh_token }, accessUser) {
  const raw = `${refresh_token ?? ''}`.trim();
  if (!raw) {
    throw new AppError(AUTH_MESSAGES.LOGOUT_REFRESH_REQUIRED, 400, null, true);
  }

  assertJwtSecretsLoaded();
  let payload;
  try {
    payload = jwt.verify(raw, process.env.JWT_REFRESH_SECRET, jwtVerifyOptions());
  } catch (_) {
    throw new AppError(AUTH_MESSAGES.LOGOUT_REFRESH_INVALID, 401, null, true);
  }

  if (payload.token_use !== 'refresh' || `${payload.sub}` !== `${accessUser.id}`) {
    throw new AppError(AUTH_MESSAGES.LOGOUT_REFRESH_WRONG_SUBJECT, 403, null, true);
  }

  await revokeRefreshByJti(payload.jti);
  return { encerrado: true };
}

/** GET /me */
async function getMe(userId) {
  const user = await User.findByPk(userId, {
    include: [{ model: Client, as: 'client_profile', required: false }],
  });
  if (!user) {
    throw new AppError(AUTH_MESSAGES.USER_NOT_FOUND, 404, null, true);
  }
  return { usuario: sanitizeUserRecord(user), ...(await attachRbacIfStaff(user)) };
}

/** PATCH /me */
async function patchMeProfile(userId, body) {
  const user = await User.findByPk(userId, {
    include: [{ model: Client, as: 'client_profile', required: false }],
  });
  if (!user) {
    throw new AppError(AUTH_MESSAGES.USER_NOT_FOUND, 404, null, true);
  }
  if (user.role !== AUTH_CONFIG.roleClienteNoRegistro || !user.client_profile) {
    throw new AppError(AUTH_MESSAGES.PROFILE_NOT_CLIENT_EDITABLE, 403, null, true);
  }

  const maxNome = AUTH_CONFIG.profileNomeMaxLength;
  const maxTratarPor = AUTH_CONFIG.profileTratarPorMaxLength;

  const allowed = {};
  if (typeof body.nome !== 'undefined') allowed.nome = body.nome == null ? null : `${body.nome}`.trim().slice(0, maxNome);
  if (typeof body.tratar_por !== 'undefined') {
    allowed.tratar_por = body.tratar_por == null ? null : `${body.tratar_por}`.trim().slice(0, maxTratarPor);
  }
  if (typeof body.data_nascimento !== 'undefined') {
    allowed.data_nascimento = body.data_nascimento == null || body.data_nascimento === '' ? null : body.data_nascimento;
  }

  if (Object.keys(allowed).length === 0) {
    throw new AppError(AUTH_MESSAGES.PROFILE_PATCH_NO_FIELDS, 400, null, true);
  }

  await user.client_profile.update(allowed);

  await user.reload({
    include: [{ model: Client, as: 'client_profile', required: false }],
  });

  return { usuario: sanitizeUserRecord(user) };
}

async function previewStaffInvite(token) {
  return staffInviteService.previewInvite(token);
}

async function acceptStaffInvite(body, reqMeta = {}) {
  return staffInviteService.acceptStaffInvite(body, {
    ip: reqMeta.ip,
    user_agent: reqMeta.userAgent,
  });
}

module.exports = {
  login,
  refreshToken,
  logout,
  getMe,
  patchMeProfile,
  previewStaffInvite,
  acceptStaffInvite,
};
