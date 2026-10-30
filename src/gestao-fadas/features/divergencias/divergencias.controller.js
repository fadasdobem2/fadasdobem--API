'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const divergencias = require('./divergencias.service');

/** O gate remove o envelope `{sucesso, dados}` e devolve o DTO puro, como a B. */
const rota = (fn, mensagem) => catchAsyncRoute(async (req, res) => responderSucesso(res, await fn(req), mensagem, 200));

module.exports = {
  lerDivergencias: rota(divergencias.ler, 'Divergências.'),
  gravarDivergencia: rota(divergencias.gravar, 'Divergência atualizada.'),
};
