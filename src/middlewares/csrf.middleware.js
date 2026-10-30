'use strict';

/**
 * CSRF — Double Submit Cookie assinado, via `csrf-csrf` (sucessor mantido do `csurf`, que está deprecated).
 *
 * Como funciona:
 *   1. Front faz GET `/api/v1/csrf-token` (rota emissora, abaixo). Server:
 *        a) gera um token derivado de (HMAC) `secret + sessionIdentifier + nonce`;
 *        b) seta cookie httpOnly `__Host-fdb_csrf` contendo o hash assinado;
 *        c) devolve o token em texto no body da resposta.
 *   2. Front guarda o token em memória (não em storage persistente) e injeta no
 *      header `X-CSRF-Token` em toda requisição que altera estado (POST/PUT/PATCH/DELETE).
 *   3. Em cada request mutating, este middleware compara header ↔ cookie. Se HMAC
 *      bate (ou seja, o atacante teria que ler o cookie, que é httpOnly), passa.
 *
 * Quando o `sessionIdentifier` muda (login, refresh, logout), o token antigo é invalidado.
 * Por isso o auth.controller emite um token fresco junto com cada par de cookies.
 *
 * SameSite=strict mitiga a maioria dos vetores CSRF clássicos; o double-submit
 * adiciona uma segunda camada (defesa em profundidade) que cobre casos onde
 * SameSite é menos efetivo (clickjacking + abertura nova, sub-domínios cooperativos, etc.).
 */

const { doubleCsrf } = require('csrf-csrf');
const { ACCESS_COOKIE } = require('../features/auth/auth.cookies.helper');

const CSRF_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-fdb_csrf' : 'fdb_csrf';

function csrfCookieOptions() {
  const isProd = `${process.env.NODE_ENV || ''}`.toLowerCase() === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    path: '/',
  };
}

function getSessionIdentifier(req) {
  // Pós-login: o access JWT é único por sessão (muda em refresh) — perfeito como semente.
  const access = req.cookies && req.cookies[ACCESS_COOKIE];
  if (access) return `auth:${access}`;
  // Pré-login (tela de login/registro): usa um identificador estável baseado no IP.
  // `app.set('trust proxy', ...)` precisa estar ativo em produção para que req.ip seja confiável.
  return `anon:${req.ip || 'unknown'}`;
}

function getCsrfSecret() {
  const secret = process.env.CSRF_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('CSRF_SECRET ausente ou muito curto (mínimo 32 caracteres).');
  }
  return secret;
}

const { doubleCsrfProtection, generateCsrfToken, invalidCsrfTokenError } = doubleCsrf({
  getSecret: () => getCsrfSecret(),
  getSessionIdentifier,
  cookieName: CSRF_COOKIE,
  cookieOptions: csrfCookieOptions(),
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'],
  skipCsrfProtection: (req) => {
    // Webhooks externos validados por assinatura própria (HMAC do provedor) —
    // não fazem parte do fluxo de browser e não podem ter CSRF.
    const p = req.path || '';
    if (
      p.endsWith('/chatwoot/webhook') ||
      p.endsWith('/payments/webhook') ||
      p.endsWith('/sessions/agora-webhook')
    ) {
      return true;
    }
    // Formulários públicos Trabalhe Conosco (sem sessão prévia de CSRF).
    if (
      p.endsWith('/public/tarologa/candidates') ||
      p.endsWith('/public/tarologa/candidates/validate-email') ||
      p.endsWith('/public/jobs/applications')
    ) {
      return true;
    }
    return false;
  },
});

/**
 * Limpa o cookie de CSRF — chamado no logout. Não é estritamente necessário
 * (o token sem sessão válida já é inútil), mas mantém o cookie jar limpo.
 * Precisa repetir as mesmas options de criação para o browser aceitar o clear.
 */
function clearCsrfCookie(res) {
  res.clearCookie(CSRF_COOKIE, csrfCookieOptions());
}

module.exports = {
  CSRF_COOKIE,
  doubleCsrfProtection,
  generateCsrfToken,
  invalidCsrfTokenError,
  clearCsrfCookie,
};
