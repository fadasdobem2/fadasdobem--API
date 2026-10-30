'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const orientacoes = require('./orientacoes.service');
const notas = require('./notas.service');

/** O gate remove o envelope `{sucesso, dados}` e devolve o DTO puro, como a B. */
const rota = (fn, mensagem) => catchAsyncRoute(async (req, res) => responderSucesso(res, await fn(req), mensagem, 200));

module.exports = {
  lerOrientacoes: rota(orientacoes.ler, 'Orientações financeiras das clientes.'),
  gravarOrientacao: rota(orientacoes.gravar, 'Orientação gravada.'),
  lerNotas: rota(notas.ler, 'Observações das clientes.'),
  gravarNota: rota(notas.gravar, 'Observação gravada.'),
};
