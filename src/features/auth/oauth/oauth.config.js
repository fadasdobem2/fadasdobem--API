'use strict';

const PROVIDERS = {
  google: {
    id: 'google',
    dbProvider: 'GOOGLE',
    label: 'Google',
    enabled() {
      return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
    },
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    userinfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: ['openid', 'email', 'profile'],
    usePkce: true,
  },
  facebook: {
    id: 'facebook',
    dbProvider: 'FACEBOOK',
    label: 'Facebook',
    enabled() {
      return Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET);
    },
    authorizationEndpoint: 'https://www.facebook.com/v21.0/dialog/oauth',
    tokenEndpoint: 'https://graph.facebook.com/v21.0/oauth/access_token',
    graphBase: 'https://graph.facebook.com/v21.0',
    scopes: ['email', 'public_profile'],
    usePkce: false,
  },
};

function getApiPublicBase() {
  const raw = `${process.env.API_PUBLIC_URL || ''}`.trim();
  if (raw) return raw.replace(/\/+$/, '');
  const port = process.env.PORT || 3001;
  return `http://127.0.0.1:${port}`;
}

function getOAuthRedirectUri(providerId) {
  const override = `${process.env[`${providerId.toUpperCase()}_OAUTH_REDIRECT_URI`] || ''}`.trim();
  if (override) return override;
  return `${getApiPublicBase()}/api/v1/auth/oauth/${providerId}/callback`;
}

function getAllowedFrontOrigins() {
  return (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getDefaultFrontReturnUrl() {
  const explicit = `${process.env.OAUTH_FRONT_SUCCESS_URL || ''}`.trim();
  if (explicit) return explicit;
  const origin = getAllowedFrontOrigins()[0] || 'http://localhost:3000';
  return `${origin.replace(/\/+$/, '')}/entrar`;
}

function getFrontErrorBaseUrl() {
  const explicit = `${process.env.OAUTH_FRONT_ERROR_URL || ''}`.trim();
  if (explicit) return explicit;
  const origin = getAllowedFrontOrigins()[0] || 'http://localhost:3000';
  return `${origin.replace(/\/+$/, '')}/entrar`;
}

function getProvider(providerId) {
  const p = PROVIDERS[`${providerId || ''}`.toLowerCase()];
  if (!p) return null;
  return p;
}

function listEnabledProviders() {
  return Object.values(PROVIDERS).filter((p) => p.enabled());
}

module.exports = {
  PROVIDERS,
  getProvider,
  listEnabledProviders,
  getApiPublicBase,
  getOAuthRedirectUri,
  getAllowedFrontOrigins,
  getDefaultFrontReturnUrl,
  getFrontErrorBaseUrl,
};
