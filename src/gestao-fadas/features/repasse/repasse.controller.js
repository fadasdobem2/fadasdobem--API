'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const service = require('./repasse.service');

module.exports = {
  acordo: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.acordo(req.params.id), 'Acordo de repasse do tarólogo.', 200)),
  aberturas: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.aberturas(req.params.id), 'Aberturas de repasse do tarólogo.', 200)),
};
