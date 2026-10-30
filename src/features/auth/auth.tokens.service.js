'use strict';

/**
 * Primitivas de sessão/token do auth: emissão e revogação de tokens, registro
 * de dispositivo WEB, sanitização de usuário e enriquecimento RBAC.
 * Reutilizadas por login/registro/refresh/reset.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { RefreshToken, UserDevice, StaffProfile } = require('../../models');
const {
  assertJwtSecretsLoaded,
  jwtSignOptionsAccess,
  jwtSignOptionsRefresh,
} = require('../../config/auth.config');
const { AUTH_CONFIG } = require('./auth.constants');
const { STAFF_ROLES } = require('../../rbac/rbac.constants');
const accessService = require('../admin/services/admin.access.service');

function tokenExpiresInSecondsFromJwt(token) {
  const decoded = jwt.decode(token);
  if (!decoded || !decoded.exp) return null;
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, decoded.exp - now);
}

function sanitizeUserRecord(userInstance) {
  if (!userInstance) return null;
  const plain = userInstance.get({ plain: true });
  delete plain.password_hash;
  return plain;
}

async function issueTokenPairForUser(userRecord, opts = {}) {
  assertJwtSecretsLoaded();
  const subject = userRecord.id;
  const accountType = opts.accountType ?? 'user';
  const accessExtra =
    opts &&
    opts.accessTokenClaims &&
    typeof opts.accessTokenClaims === 'object' &&
    !Array.isArray(opts.accessTokenClaims)
      ? opts.accessTokenClaims
      : {};
  const accessToken = jwt.sign(
    { sub: subject, token_use: 'access', account_type: accountType, ...accessExtra },
    process.env.JWT_SECRET,
    jwtSignOptionsAccess()
  );
  const jti = crypto.randomUUID();
  const refreshToken = jwt.sign(
    { sub: subject, token_use: 'refresh', jti },
    process.env.JWT_REFRESH_SECRET,
    jwtSignOptionsRefresh()
  );
  const decodedRefresh = jwt.decode(refreshToken);
  const expiresAt = new Date(decodedRefresh.exp * 1000);

  await RefreshToken.create({
    [accountType === 'temp' ? 'temp_user_id' : 'user_id']: subject,
    jti,
    expires_at: expiresAt,
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    access_expires_in: tokenExpiresInSecondsFromJwt(accessToken),
    refresh_expires_in: tokenExpiresInSecondsFromJwt(refreshToken),
  };
}

async function revokeRefreshByJti(jti) {
  const [affected] = await RefreshToken.update(
    { revoked_at: new Date() },
    {
      where: {
        jti,
        revoked_at: null,
      },
    }
  );
  return affected;
}

async function revokeAllRefreshTokensForUser(userId) {
  await RefreshToken.update(
    { revoked_at: new Date() },
    {
      where: {
        user_id: userId,
        revoked_at: null,
      },
    }
  );
}

/** R8.1 — registo/leitura de sessão WEB por IP/User-Agent */
async function recordWebLoginDevice(userId, ip, userAgent) {
  const ua = `${userAgent || ''}`.trim();
  const ipStr = `${ip || ''}`.slice(0, 45);
  const hash = crypto
    .createHash('sha256')
    .update(`${userId}|${ipStr}|${ua}`)
    .digest('hex')
    .slice(0, 48);
  const token = `${AUTH_CONFIG.webDeviceTokenPrefix}${hash}`;

  const [device] = await UserDevice.findOrCreate({
    where: { user_id: userId, push_token: token },
    defaults: {
      user_id: userId,
      push_token: token,
      platform: 'WEB',
      device_name: ua ? ua.slice(0, 128) : 'Web',
      last_seen_at: new Date(),
      is_active: true,
    },
  });

  await device.update({
    last_seen_at: new Date(),
    ...(ua ? { device_name: ua.slice(0, 128) } : {}),
  });
}

async function attachRbacIfStaff(user) {
  if (!user?.id || !STAFF_ROLES.has(`${user.role || ''}`)) return {};
  const extra = {};
  try {
    extra.rbac = await accessService.getMyAccess(user.id);
  } catch {
    /* rbac opcional — segue sem bloquear login */
  }
  try {
    const profile = await StaffProfile.findOne({
      where: { user_id: user.id },
      attributes: ['must_change_password'],
    });
    extra.must_change_password = !!profile?.must_change_password;
  } catch {
    /* flag opcional */
  }
  return extra;
}

module.exports = {
  tokenExpiresInSecondsFromJwt,
  sanitizeUserRecord,
  issueTokenPairForUser,
  revokeRefreshByJti,
  revokeAllRefreshTokensForUser,
  recordWebLoginDevice,
  attachRbacIfStaff,
};
