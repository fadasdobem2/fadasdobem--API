'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const service = require('./tarologos.service');

module.exports = {
  listar: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.listar(req.query || {}), 'Tarólogos do legado.', 200)),
  obter: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.obter(req.params.id, req.query || {}), 'Tarólogo do legado.', 200)),
};
