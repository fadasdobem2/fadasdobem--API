'use strict';

const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const { setAuthCookies } = require('../auth/auth.cookies.helper');
const { generateCsrfToken } = require('../../middlewares/csrf.middleware');
const { ACCESS_COOKIE } = require('../auth/auth.cookies.helper');
const recoveryService = require('./account-recovery.service');

function reqMeta(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

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
    recovery_request: dados.recovery_request,
    csrfToken,
  };
}

module.exports = {
  /**
   * POST /v1/account-recovery/request
   * Cria conta temporária + solicitação de recuperação.
   * Responde com cookies de autenticação (igual ao login/register).
   */
  createRequest: catchAsyncRoute(async (req, res) => {
    const dados = await recoveryService.createRecoveryRequest(req.body || {}, reqMeta(req));
    setAuthCookies(res, dados);
    const body = buildAuthResponseBody(req, res, dados);
    return responderSucesso(res, body, 'Conta temporária criada. Nossa equipe entrará em contato em breve.', 201);
  }),

  /**
   * GET /v1/account-recovery/status
   * Retorna o status atual da solicitação de recuperação do usuário logado.
   */
  getStatus: catchAsyncRoute(async (req, res) => {
    const dados = await recoveryService.getMyRecoveryStatus(req.user.id);
    return responderSucesso(res, dados, 'Status da recuperação de conta.', 200);
  }),

  /**
   * POST /v1/account-recovery/message
   * Usuário envia mensagem ao suporte dentro da solicitação.
   */
  sendMessage: catchAsyncRoute(async (req, res) => {
    const dados = await recoveryService.sendUserMessage(req.user.id, req.body || {});
    return responderSucesso(res, dados, 'Mensagem enviada.', 201);
  }),
};
