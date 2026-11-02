'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const migracao = require('./migracao.service');
const conferencia = require('./migracao.conferencia');

/** O gate remove o envelope `{sucesso, dados}` e devolve o DTO puro, como a B. */
const rota = (fn, mensagem) => catchAsyncRoute(async (req, res) => responderSucesso(res, await fn(req), mensagem, 200));

module.exports = {
  lerHistoricos: rota(migracao.ler, 'Históricos de migração.'),
  obterHistorico: rota(migracao.obter, 'Histórico de migração.'),
  aplicarLote: rota(migracao.aplicar, 'Migração aplicada.'),
  conferir: rota(conferencia.conferencia, 'Conferência da migração.'),
  semPlanilha: rota(conferencia.semPlanilha, 'Clientes sem planilha.'),
};
