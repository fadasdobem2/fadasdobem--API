'use strict';

/**
 * Helpers para gerir os cookies httpOnly de autenticação.
 *
 * Estratégia de segurança (produção real):
 *   - Cookies `httpOnly: true`              → impede leitura via document.cookie / JS (XSS).
 *   - `secure: true`                        → só viajam em HTTPS (localhost é tratado como secure context).
 *   - `sameSite: 'strict'`                  → bloqueia envio em navegação cross-site.
 *   - Prefixo `__Secure-`                   → cookie só é aceito se Secure=true (proteção contra cookie-jar
 *                                             tossing em sub-domínios). Permite Path arbitrário.
 *   - `domain` deliberadamente NÃO setado   → o cookie fica colado no host emissor (api.fadasdobem.com.br),
 *                                             impedindo que sub-domínios o leiam/escrevam.
 *
 * Paths intencionalmente escopados:
 *   - access  → `/api`           (presente em qualquer chamada autenticada)
 *   - refresh → `/api/v1/auth`   (só viaja nas duas rotas que precisam, reduzindo blast radius)
 */

const isProd = `${process.env.NODE_ENV || ''}`.toLowerCase() === 'production';

const ACCESS_COOKIE = isProd ? '__Secure-fdb_access' : 'fdb_access';
const REFRESH_COOKIE = isProd ? '__Secure-fdb_refresh' : 'fdb_refresh';

const ACCESS_PATH = '/api';
const REFRESH_PATH = '/api/v1/auth';

function baseOpts() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
  };
}

/**
 * Persiste o par access/refresh em cookies httpOnly após login, register ou refresh.
 * @param {import('express').Response} res
 * @param {{ access_token:string, refresh_token:string, access_expires_in:number, refresh_expires_in:number }} tokens
 */
function setAuthCookies(res, tokens) {
  res.cookie(ACCESS_COOKIE, tokens.access_token, {
    ...baseOpts(),
    path: ACCESS_PATH,
    maxAge: (tokens.access_expires_in || 0) * 1000,
  });

  res.cookie(REFRESH_COOKIE, tokens.refresh_token, {
    ...baseOpts(),
    path: REFRESH_PATH,
    maxAge: (tokens.refresh_expires_in || 0) * 1000,
  });
}

/**
 * Remove os cookies de auth. Importante repetir as `options` (path, sameSite, secure) para
 * o browser aceitar o clear — caso contrário ele trata como cookie diferente e ignora.
 * @param {import('express').Response} res
 */
function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...baseOpts(), path: ACCESS_PATH });
  res.clearCookie(REFRESH_COOKIE, { ...baseOpts(), path: REFRESH_PATH });
}

module.exports = {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  ACCESS_PATH,
  REFRESH_PATH,
  setAuthCookies,
  clearAuthCookies,
};
