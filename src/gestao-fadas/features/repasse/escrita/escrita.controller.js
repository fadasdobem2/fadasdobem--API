'use strict';

const { responderSucesso } = require('../../../../utils/response.util');
const { catchAsyncRoute } = require('../../../../utils/catchAsync.util');
const { servico } = require('./escrita.service');

/** Controllers das gravações (201 ao criar, 200 ao confirmar, como a B). Aceita o serviço injetado nos testes. */
function criarControllers(s = servico) {
  return {
    percentual: catchAsyncRoute(async (req, res) => responderSucesso(res, await s.percentual(req), 'Percentual de repasse registrado.', 201)),
    calendario: catchAsyncRoute(async (req, res) => responderSucesso(res, await s.calendario(req), 'Calendário de pagamento registrado.', 201)),
    rascunho: catchAsyncRoute(async (req, res) => responderSucesso(res, await s.rascunho(req), 'Rascunho da abertura registrado.', 201)),
    confirmar: catchAsyncRoute(async (req, res) => responderSucesso(res, await s.confirmar(req), 'Abertura confirmada.', 200)),
    corrigir: catchAsyncRoute(async (req, res) => responderSucesso(res, await s.corrigir(req), 'Correção da abertura registrada em rascunho.', 201)),
  };
}

module.exports = { criarControllers, ...criarControllers() };
