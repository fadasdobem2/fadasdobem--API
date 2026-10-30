'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const service = require('./presenca.service');

/** O gate remove o envelope `{sucesso, dados}` e devolve o DTO puro, como a B. */
module.exports = {
  ler: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.ler(req), 'Presença.', 200)),
  status: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.mudarStatus(req), 'Presença registrada.', 200)),
  confirmar: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.confirmar(req), 'Presença confirmada.', 200)),
  pedir: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.pedirConfirmacao(req), 'Pedido de confirmação registrado.', 200)),
  atividade: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.registrarBatimento(req), 'Atividade registrada.', 200)),
};
