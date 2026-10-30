'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const service = require('./agenda.service');
const ordem = require('./agenda-ordem.service');

/** O gate remove o envelope `{sucesso, dados}` e devolve o DTO puro, como a B. */
const comando = (grupo, mensagem) => catchAsyncRoute(async (req, res) => responderSucesso(res, await service.comando(req, grupo), mensagem, 200));

module.exports = {
  ler: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.ler(req), 'Agenda.', 200)),
  criar: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.criar(req), 'Agendamento registrado.', 200)),
  editar: comando('agendamento', 'Agendamento atualizado.'),
  contato: comando('contato', 'Contato registrado.'),
  observacoes: comando('observacoes', 'Observação registrada.'),
  saidas: comando('saidas', 'Saída registrada.'),
  prazo: comando('prazo', 'Prazo combinado registrado.'),
  resolucao: comando('resolucao', 'Resolução registrada.'),
  ordenar: catchAsyncRoute(async (req, res) => responderSucesso(res, await ordem.ordenar(req), 'Ordem da fila registrada.', 200)),
};
