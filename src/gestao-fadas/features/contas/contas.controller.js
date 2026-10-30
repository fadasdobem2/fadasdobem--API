'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const service = require('./contas.service');

/** O gate remove o envelope `{sucesso, dados}` e devolve o DTO puro, como a B. */
module.exports = {
  ler: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.ler(req), 'Contas.', 200)),
  criar: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.criar(req), 'Conta criada.', 200)),
  editar: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.editar(req), 'Conta atualizada.', 200)),
  senha: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.trocarSenha(req), 'Senha redefinida.', 200)),
  ativo: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.definirAtivo(req), 'Acesso atualizado.', 200)),
};
