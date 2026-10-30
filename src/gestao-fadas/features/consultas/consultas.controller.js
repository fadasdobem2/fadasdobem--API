'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const service = require('./consultas.service');
const { entregarExportacao } = require('../../_comum/exportacao');
const { resolverPerfil } = require('../../_comum/politica-acesso');
const { contaDaRequisicao } = require('../../_comum/conta');

module.exports = {
  /** GET /export: o recorte inteiro em .xlsx (R23). Grava `operations.export.download` antes; sem a linha, 503 e sem arquivo. */
  exportar: catchAsyncRoute(async (req, res) => {
    const exportacao = await service.exportar(req.query || {});
    return entregarExportacao(res, { accountId: contaDaRequisicao(req), role: resolverPerfil(req) }, exportacao);
  }),

  // O DTO interno é o da B (`readAt`, `today`, `range`, ...); o envelope { sucesso, mensagem, dados } é o da A.
  listar: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.listar(req.query || {}), 'Consultas do legado.', 200)),
};
