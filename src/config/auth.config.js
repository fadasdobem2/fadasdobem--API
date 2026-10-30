/**
 * Configuração central de JWT usada pelo módulo de autenticação.
 */
const ISSUER = process.env.JWT_ISSUER || 'fadasdobem-api';
const AUDIENCE = process.env.JWT_AUDIENCE || 'fadasdobem-clients';

const ACCESS_TTL = process.env.JWT_EXPIRES_IN || '30m';
const REFRESH_TTL = process.env.JWT_REFRESH_EXPIRES_IN || '12h';

function assertJwtSecretsLoaded() {
  const access = process.env.JWT_SECRET;
  const refresh = process.env.JWT_REFRESH_SECRET;
  if (!access || access.length < 32) {
    throw new Error('JWT_SECRET ausente ou muito curto (mínimo 32 caracteres).');
  }
  if (!refresh || refresh.length < 32) {
    throw new Error('JWT_REFRESH_SECRET ausente ou muito curto (mínimo 32 caracteres).');
  }
}

function jwtSignOptionsAccess() {
  return {
    expiresIn: ACCESS_TTL,
    issuer: ISSUER,
    audience: AUDIENCE,
  };
}

function jwtSignOptionsRefresh() {
  return {
    expiresIn: REFRESH_TTL,
    issuer: ISSUER,
    audience: AUDIENCE,
  };
}

function jwtVerifyOptions() {
  return {
    issuer: ISSUER,
    audience: AUDIENCE,
  };
}

module.exports = {
  ISSUER,
  AUDIENCE,
  ACCESS_TTL,
  REFRESH_TTL,
  assertJwtSecretsLoaded,
  jwtSignOptionsAccess,
  jwtSignOptionsRefresh,
  jwtVerifyOptions,
};
