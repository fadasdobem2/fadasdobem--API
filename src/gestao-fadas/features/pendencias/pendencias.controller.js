'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const pendencias = require('./pendencias.service');

/** O gate remove o envelope `{sucesso, dados}` e devolve o DTO puro, como a B. */
const rota = (fn, mensagem) => catchAsyncRoute(async (req, res) => responderSucesso(res, await fn(req), mensagem, 200));

module.exports = {
  lerEncaminhamentos: rota(pendencias.ler, 'Encaminhamentos das pendências.'),
  lerDerivadas: rota(pendencias.derivadas, 'Pendências derivadas das fontes.'),
  gravarEncaminhamento: rota(pendencias.gravar, 'Encaminhamento gravado.'),
};
