'use strict';

const authService = require('./auth.service');
const {
  setAuthCookies,
  clearAuthCookies,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} = require('./auth.cookies.helper');
const { generateCsrfToken, clearCsrfCookie } = require('../../middlewares/csrf.middleware');
const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const AppError = require('../../utils/AppError');

function reqMeta(req) {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

/**
 * Resposta padrão pós-autenticação: NUNCA contém os tokens (esses só vivem em cookies httpOnly).
 *
 * O CSRF é derivado da `sessionIdentifier`, que por sua vez depende do cookie de access.
 * Como `res.cookie(...)` só afeta a resposta — não muda `req.cookies` do request atual —
 * precisamos PROPAGAR o novo access para `req.cookies` ANTES de gerar o CSRF token,
 * caso contrário o token seria emitido para a session anterior (anônima ou pré-refresh)
 * e validaria 403 em todas as próximas chamadas autenticadas.
 *
 * `overwrite: true` garante que o cookie `__Host-fdb_csrf` é regerado e atrelado à nova
 * sessão — invalidando qualquer token CSRF anterior que tenha vazado.
 */
function buildAuthResponseBody(req, res, dados) {
  if (dados?.access_token) {
    req.cookies = req.cookies || {};
    req.cookies[ACCESS_COOKIE] = dados.access_token;
  }
  const csrfToken = generateCsrfToken(req, res, { overwrite: true });
  return {
    usuario: dados.usuario,
    access_expires_in: dados.access_expires_in,
    refresh_expires_in: dados.refresh_expires_in,
    csrfToken,
    ...(dados.must_change_password ? { must_change_password: true } : {}),
  };
}

module.exports = {
  /**
   * GET /v1/auth/csrf-token
   * Endpoint emissor de CSRF token. Usado pelo front antes do login (sessão anônima).
   * Após login, um novo token é embutido na própria resposta de /login.
   */
  csrfToken: catchAsyncRoute(async (req, res) => {
    const csrfToken = generateCsrfToken(req, res);
    return responderSucesso(res, { csrfToken }, 'CSRF token emitido.', 200);
  }),

  register: catchAsyncRoute(async (req, res) => {
    const dados = await authService.register(req.body, reqMeta(req));
    if (dados?.access_token) setAuthCookies(res, dados);
    return responderSucesso(res, buildAuthResponseBody(req, res, dados), 'Conta criada com sucesso.', 201);
  }),

  login: catchAsyncRoute(async (req, res) => {
    const dados = await authService.login(req.body, reqMeta(req));
    setAuthCookies(res, dados);
    return responderSucesso(res, buildAuthResponseBody(req, res, dados), 'Login realizado com sucesso.', 200);
  }),

  refreshToken: catchAsyncRoute(async (req, res) => {
    const refresh = req.cookies && req.cookies[REFRESH_COOKIE];
    if (!refresh) {
      throw new AppError('Sessão expirada. Faça login novamente.', 401, null, true);
    }
    const dados = await authService.refreshToken({ refresh_token: refresh });
    setAuthCookies(res, dados);
    return responderSucesso(res, buildAuthResponseBody(req, res, dados), 'Tokens renovados com sucesso.', 200);
  }),

  logout: catchAsyncRoute(async (req, res) => {
    const refresh = req.cookies && req.cookies[REFRESH_COOKIE];
    try {
      if (refresh) {
        await authService.logout({ refresh_token: refresh }, req.user);
      }
    } finally {
      clearAuthCookies(res);
      clearCsrfCookie(res);
    }
    return responderSucesso(res, { ok: true }, 'Sessão encerrada com sucesso.', 200);
  }),

  forgotPassword: catchAsyncRoute(async (req, res) => {
    const dados = await authService.forgotPassword(req.body, reqMeta(req));
    const msg =
      dados?.canal === 'whatsapp'
        ? 'Código enviado por WhatsApp. Verifique seu celular.'
        : 'Código enviado por e-mail. Verifique sua caixa de entrada.';
    return responderSucesso(res, dados, msg, 200);
  }),

  resetPassword: catchAsyncRoute(async (req, res) => {
    const dados = await authService.resetPassword(req.body, reqMeta(req));
    return responderSucesso(res, dados, 'Senha redefinida com sucesso.', 200);
  }),

  verifyEmail: catchAsyncRoute(async (req, res) => {
    const dados = await authService.verifyEmailFromToken(req.query.token, reqMeta(req));
    return responderSucesso(res, dados, dados.mensagem || 'E-mail confirmado.', 200);
  }),

  resendVerification: catchAsyncRoute(async (req, res) => {
    const dados = await authService.resendVerificationEmail(req.user, reqMeta(req));
    return responderSucesso(res, dados, 'Se aplicável, reenviamos o e-mail de confirmação.', 200);
  }),

  getMe: catchAsyncRoute(async (req, res) => {
    const dados = await authService.getMe(req.user.id);
    return responderSucesso(res, dados, 'Perfil carregado.', 200);
  }),

  patchMe: catchAsyncRoute(async (req, res) => {
    const dados = await authService.patchMeProfile(req.user.id, req.body);
    return responderSucesso(res, dados, 'Perfil atualizado.', 200);
  }),

  previewStaffInvite: catchAsyncRoute(async (req, res) => {
    const token = req.query.token || req.body?.token;
    const dados = await authService.previewStaffInvite(token);
    return responderSucesso(res, dados, 'Convite válido.', 200);
  }),

  acceptStaffInvite: catchAsyncRoute(async (req, res) => {
    const dados = await authService.acceptStaffInvite(req.body || {}, reqMeta(req));
    return responderSucesso(res, dados, 'Convite aceite — pode iniciar sessão.', 200);
  }),
};
