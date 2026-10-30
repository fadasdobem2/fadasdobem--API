'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const service = require('./horarios.service');

/** O gate remove o envelope `{sucesso, dados}` e devolve o DTO puro, como a B. */
module.exports = {
  ler: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.ler(req), 'Horários e escala.', 200)),
  gravarExcecao: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.gravarExcecao(req), 'Horário registrado.', 200)),
  removerExcecao: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.removerExcecao(req), 'Horário removido.', 200)),
  gravarSemanal: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.gravarSemanal(req), 'Escala semanal registrada.', 200)),
};
