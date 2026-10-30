'use strict';

const AppError = require('../../../utils/AppError');
const { getOAuthRedirectUri } = require('./oauth.config');

async function parseJsonResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function buildAuthorizationUrl(provider, { state, codeChallenge, redirectUri }) {
  const params = new URLSearchParams({
    client_id: provider.id === 'google' ? process.env.GOOGLE_OAUTH_CLIENT_ID : process.env.FACEBOOK_APP_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });

  if (provider.id === 'google') {
    params.set('scope', provider.scopes.join(' '));
    params.set('access_type', 'online');
    params.set('prompt', 'select_account');
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }
  } else {
    params.set('scope', provider.scopes.join(','));
  }

  return `${provider.authorizationEndpoint}?${params.toString()}`;
}

async function exchangeGoogleCode(code, redirectUri, codeVerifier) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  if (codeVerifier) body.set('code_verifier', codeVerifier);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const json = await parseJsonResponse(res);
  if (!res.ok) {
    throw new AppError(json.error_description || json.error || 'Falha ao trocar code Google.', 502, null, true);
  }
  return json;
}

async function fetchGoogleProfile(accessToken) {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const json = await parseJsonResponse(res);
  if (!res.ok) {
    throw new AppError('Não foi possível obter perfil Google.', 502, null, true);
  }
  return {
    providerUserId: `${json.sub || ''}`,
    email: json.email ? `${json.email}`.trim().toLowerCase() : null,
    emailVerified: Boolean(json.email_verified),
    name: json.name || null,
    givenName: json.given_name || null,
    familyName: json.family_name || null,
    picture: json.picture || null,
    raw: json,
  };
}

async function exchangeFacebookCode(code, redirectUri) {
  const params = new URLSearchParams({
    client_id: process.env.FACEBOOK_APP_ID,
    client_secret: process.env.FACEBOOK_APP_SECRET,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  const json = await parseJsonResponse(res);
  if (!res.ok || !json.access_token) {
    throw new AppError(json.error?.message || 'Falha ao trocar code Facebook.', 502, null, true);
  }
  return json;
}

async function fetchFacebookProfile(accessToken) {
  const fields = 'id,name,email,first_name,last_name,picture';
  const res = await fetch(
    `https://graph.facebook.com/v21.0/me?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}`,
    { headers: { Accept: 'application/json' } }
  );
  const json = await parseJsonResponse(res);
  if (!res.ok || !json.id) {
    throw new AppError(json.error?.message || 'Não foi possível obter perfil Facebook.', 502, null, true);
  }
  return {
    providerUserId: `${json.id}`,
    email: json.email ? `${json.email}`.trim().toLowerCase() : null,
    emailVerified: Boolean(json.email),
    name: json.name || null,
    givenName: json.first_name || null,
    familyName: json.last_name || null,
    picture: json.picture?.data?.url || null,
    raw: json,
  };
}

async function resolveProviderProfile(provider, code, codeVerifier) {
  const redirectUri = getOAuthRedirectUri(provider.id);

  if (provider.id === 'google') {
    const tokens = await exchangeGoogleCode(code, redirectUri, codeVerifier);
    const profile = await fetchGoogleProfile(tokens.access_token);
    return { profile, tokens };
  }

  const tokens = await exchangeFacebookCode(code, redirectUri);
  const profile = await fetchFacebookProfile(tokens.access_token);
  return { profile, tokens };
}

module.exports = {
  buildAuthorizationUrl,
  resolveProviderProfile,
};
