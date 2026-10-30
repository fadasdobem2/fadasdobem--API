'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const service = require('./agenda-fila.service');

module.exports = {
  encaminhar: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.encaminhar(req), 'Cliente encaminhada.', 200)),
  liberar: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.liberar(req), 'Reserva liberada.', 200)),
};
