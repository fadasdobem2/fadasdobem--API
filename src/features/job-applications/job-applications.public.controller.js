'use strict';

const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const service = require('./job-applications.service');

function httpCtx(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress,
    user_agent: req.headers['user-agent'],
    correlation_id: req.headers['x-request-id'],
  };
}

module.exports = {
  submit: catchAsyncRoute(async (req, res) => {
    const dados = await service.submitPublicJobApplication(req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, dados.message || 'Candidatura enviada.', 201);
  }),
};
