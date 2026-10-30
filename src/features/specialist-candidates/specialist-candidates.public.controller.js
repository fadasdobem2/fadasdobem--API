'use strict';

const { responderSucesso, responderErro } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const service = require('./specialist-candidates.service');
const { assertTrabalheConoscoEmail } = require('../trabalhe-conosco/trabalhe-conosco.email');

function httpCtx(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress,
    user_agent: req.headers['user-agent'],
    correlation_id: req.headers['x-request-id'],
  };
}

module.exports = {
  submitF1: catchAsyncRoute(async (req, res) => {
    const dados = await service.submitPublicF1(req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, dados.message || 'Candidatura enviada.', 201);
  }),

  validateEmail: catchAsyncRoute(async (req, res) => {
    const email = `${req.body?.email ?? req.query?.email ?? ''}`.trim();
    if (!email) {
      return responderErro(res, 400, 'Informe o e-mail.');
    }
    try {
      assertTrabalheConoscoEmail(email);
      return responderSucesso(res, { allowed: true }, 'E-mail válido.', 200);
    } catch (err) {
      return responderSucesso(
        res,
        { allowed: false, reason: err.message },
        err.message,
        200
      );
    }
  }),

  getOnboarding: catchAsyncRoute(async (req, res) => {
    const dados = await service.getPublicOnboardingByToken(req.params.token);
    return responderSucesso(res, dados, 'Onboarding válido.', 200);
  }),

  submitF2: catchAsyncRoute(async (req, res) => {
    const dados = await service.submitPublicF2(req.params.token, req.body || {});
    return responderSucesso(res, dados, 'Formulário 2 recebido.', 200);
  }),
};
