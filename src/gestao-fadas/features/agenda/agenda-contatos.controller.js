'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const service = require('./agenda-contatos.service');

/** O gate remove o envelope `{sucesso, dados}` e devolve o DTO puro, como a B. */
module.exports = {
  lerContatos: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.lerContatos(req), 'Contatos da agenda.', 200)),
  salvarContato: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.salvarContato(req), 'Contato salvo.', 200)),
};
