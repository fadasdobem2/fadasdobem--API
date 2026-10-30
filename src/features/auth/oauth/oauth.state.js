'use strict';

const crypto = require('crypto');

const OAUTH_CTX_COOKIE = '__Secure-fdb_oauth_ctx';
const TTL_MS = 10 * 60 * 1000;

function getStateSecret() {
  const secret =
    process.env.OAUTH_STATE_SECRET ||
    process.env.CSRF_SECRET ||
    process.env.JWT_SECRET ||
    '';
  if (`${secret}`.length < 32) {
    throw new Error('OAUTH_STATE_SECRET/CSRF_SECRET/JWT_SECRET ausente ou curto demais para OAuth.');
  }
  return secret;
}

function cookieOpts(maxAgeMs = TTL_MS) {
  const isProd = `${process.env.NODE_ENV || ''}`.toLowerCase() === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/api/v1/auth/oauth',
    maxAge: maxAgeMs,
  };
}

function signPayload(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', getStateSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySignedToken(token) {
  const parts = `${token || ''}`.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', getStateSecret()).update(payload).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function writeOAuthContext(res, ctx) {
  const signed = signPayload({ ...ctx, exp: Date.now() + TTL_MS });
  res.cookie(OAUTH_CTX_COOKIE, signed, cookieOpts());
}

function readOAuthContext(req) {
  const raw = req.cookies?.[OAUTH_CTX_COOKIE];
  if (!raw) return null;
  const data = verifySignedToken(raw);
  if (!data || !data.exp || data.exp < Date.now()) return null;
  return data;
}

function clearOAuthContext(res) {
  res.clearCookie(OAUTH_CTX_COOKIE, cookieOpts(0));
}

/** Estado OAuth assinado na query `state` (não depende de cookie entre hosts). */
function packOAuthState(ctx) {
  return signPayload({ ...ctx, exp: Date.now() + TTL_MS });
}

function unpackOAuthState(stateParam) {
  const data = verifySignedToken(stateParam);
  if (!data || !data.exp || data.exp < Date.now()) return null;
  return data;
}

module.exports = {
  OAUTH_CTX_COOKIE,
  writeOAuthContext,
  readOAuthContext,
  clearOAuthContext,
  packOAuthState,
  unpackOAuthState,
};
