'use strict';

const AppError = require('../../../utils/AppError');
const { ACCESS_COOKIE } = require('../auth.cookies.helper');
const { setAuthCookies } = require('../auth.cookies.helper');
const { generateCsrfToken } = require('../../../middlewares/csrf.middleware');
const {
  getProvider,
  getDefaultFrontReturnUrl,
  getFrontErrorBaseUrl,
  getAllowedFrontOrigins,
  listEnabledProviders,
} = require('./oauth.config');
const { generatePkcePair, generateState } = require('./oauth.pkce');
const { buildAuthorizationUrl, resolveProviderProfile } = require('./oauth.providers');
const {
  writeOAuthContext,
  readOAuthContext,
  clearOAuthContext,
  packOAuthState,
  unpackOAuthState,
} = require('./oauth.state');
const oauthService = require('./oauth.service');

function reqMeta(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

function sanitizeReturnTo(raw) {
  const fallback = getDefaultFrontReturnUrl();
  const candidate = `${raw || ''}`.trim();
  if (!candidate) return fallback;

  const allowedOrigins = getAllowedFrontOrigins();

  try {
    if (candidate.startsWith('/')) {
      const origin = allowedOrigins[0] || 'http://localhost:3000';
      return `${origin.replace(/\/+$/, '')}${candidate}`;
    }
    const url = new URL(candidate);
    if (allowedOrigins.includes(url.origin)) return url.toString();
  } catch {
    /* ignore */
  }
  return fallback;
}

function buildFrontRedirect(baseUrl, params = {}) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && `${value}`.length) url.searchParams.set(key, `${value}`);
  }
  return url.toString();
}

function establishAuthCookies(req, res, tokens) {
  setAuthCookies(res, tokens);
  req.cookies = req.cookies || {};
  req.cookies[ACCESS_COOKIE] = tokens.access_token;
  generateCsrfToken(req, res, { overwrite: true });
}

function mapOAuthRedirectError(err, providerId) {
  const code = err?.dados?.code || err?.code;
  if (code === 'OAUTH_EMAIL_PASSWORD_EXISTS') {
    return buildFrontRedirect(getFrontErrorBaseUrl(), {
      oauth: 'email_existe',
      provider: providerId,
    });
  }
  if (code === 'OAUTH_EMAIL_MISSING') {
    return buildFrontRedirect(getFrontErrorBaseUrl(), {
      oauth: 'sem_email',
      provider: providerId,
    });
  }
  return buildFrontRedirect(getFrontErrorBaseUrl(), { oauth: 'tecnico', provider: providerId });
}

async function startOAuth(req, res, providerId) {
  const provider = getProvider(providerId);
  if (!provider) throw new AppError('Provedor OAuth inválido.', 400, null, true);
  if (!provider.enabled()) {
    throw new AppError(`${provider.label} OAuth não configurado neste ambiente.`, 503, null, true);
  }

  const pkce = provider.usePkce ? generatePkcePair() : null;
  const returnTo = sanitizeReturnTo(req.query.return_to || req.query.returnTo);
  const nonce = generateState();

  const ctxPayload = {
    nonce,
    provider: provider.id,
    codeVerifier: pkce?.codeVerifier || null,
    returnTo,
  };

  const state = packOAuthState(ctxPayload);

  writeOAuthContext(res, { state: nonce, ...ctxPayload });

  const redirectUri = require('./oauth.config').getOAuthRedirectUri(provider.id);
  const authUrl = buildAuthorizationUrl(provider, {
    state,
    codeChallenge: pkce?.codeChallenge,
    redirectUri,
  });

  return res.redirect(302, authUrl);
}

async function handleOAuthCallback(req, res, providerId) {
  const provider = getProvider(providerId);
  if (!provider) throw new AppError('Provedor OAuth inválido.', 400, null, true);

  const oauthError = `${req.query.error || ''}`.trim();
  if (oauthError) {
    const desc = `${req.query.error_description || ''}`.trim();
    if (oauthError === 'access_denied') {
      return res.redirect(302, buildFrontRedirect(getFrontErrorBaseUrl(), { oauth: 'cancelado', provider: providerId }));
    }
    return res.redirect(
      302,
      buildFrontRedirect(getFrontErrorBaseUrl(), {
        oauth: 'tecnico',
        provider: providerId,
        reason: desc || oauthError,
      })
    );
  }

  const code = `${req.query.code || ''}`.trim();
  const state = `${req.query.state || ''}`.trim();
  const packedCtx = unpackOAuthState(state);
  const cookieCtx = readOAuthContext(req);
  clearOAuthContext(res);

  const ctx =
    packedCtx && packedCtx.provider === providerId
      ? packedCtx
      : cookieCtx && cookieCtx.state && state && cookieCtx.state === state && cookieCtx.provider === providerId
        ? cookieCtx
        : null;

  if (!ctx || !code || !state) {
    console.warn('[oauth.callback] contexto inválido', {
      provider: providerId,
      hasCode: Boolean(code),
      hasPackedCtx: Boolean(packedCtx),
      hasCookieCtx: Boolean(cookieCtx),
    });
    return res.redirect(302, buildFrontRedirect(getFrontErrorBaseUrl(), { oauth: 'tecnico', provider: providerId }));
  }

  try {
    const { profile } = await resolveProviderProfile(provider, code, ctx.codeVerifier);
    if (!profile.providerUserId) {
      throw new AppError('Identificador do provedor ausente.', 502, null, true);
    }

    const result = await oauthService.loginOrRegisterWithOAuth(
      {
        providerDb: provider.dbProvider,
        providerUserId: profile.providerUserId,
        email: profile.email,
        emailVerified: profile.emailVerified,
        displayName: profile.name,
        profilePayload: {
          email: profile.email,
          name: profile.name,
          given_name: profile.givenName,
          family_name: profile.familyName,
          picture: profile.picture,
          provider: provider.id,
          raw: profile.raw,
        },
      },
      reqMeta(req)
    );

    establishAuthCookies(req, res, result.tokens);

    const providerKey = provider.id === 'google' ? 'google' : 'facebook';
    const redirectParams = result.needsProfile
      ? { oauth: providerKey, needs_profile: '1' }
      : { oauth: 'ok' };

    return res.redirect(302, buildFrontRedirect(ctx.returnTo || getDefaultFrontReturnUrl(), redirectParams));
  } catch (err) {
    if (err instanceof AppError) {
      return res.redirect(302, mapOAuthRedirectError(err, providerId));
    }
    console.error('[oauth.callback]', providerId, err);
    return res.redirect(302, buildFrontRedirect(getFrontErrorBaseUrl(), { oauth: 'tecnico', provider: providerId }));
  }
}

function statusOAuth(_req, res) {
  const providers = listEnabledProviders().map((p) => ({
    id: p.id,
    label: p.label,
    start_url: `/api/v1/auth/oauth/${p.id}/start`,
  }));
  return res.status(200).json({
    sucesso: true,
    mensagem: 'OAuth providers.',
    dados: { providers },
  });
}

module.exports = {
  startOAuth,
  handleOAuthCallback,
  statusOAuth,
  sanitizeReturnTo,
};
