'use strict';

const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const configService = require('./config.service');

/**
 * GET /api/v1/config/public
 * Sem segredos. Delega a montagem do payload ao `config.service`.
 */
const getPublic = catchAsyncRoute(async (_req, res) => {
  const dados = await configService.getPublicConfig();
  return responderSucesso(res, dados, 'Configuração pública.', 200);
});

module.exports = { getPublic };
