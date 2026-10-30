'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const service = require('./agenda-admissao.service');

/** O gate remove o envelope `{sucesso, dados}` e devolve o DTO puro, como a B. */
module.exports = {
  lerAdmissoes: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.lerAdmissoes(req), 'Admissão do turno.', 200)),
  registrarAdmissao: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.registrarAdmissao(req), 'Admissão registrada.', 200)),
  lerSolicitacoes: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.lerSolicitacoes(req), 'Solicitações de consulta.', 200)),
  registrarSolicitacao: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.registrarSolicitacao(req), 'Solicitação registrada.', 200)),
  resolverSolicitacao: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.resolverSolicitacao(req), 'Solicitação resolvida.', 200)),
};
