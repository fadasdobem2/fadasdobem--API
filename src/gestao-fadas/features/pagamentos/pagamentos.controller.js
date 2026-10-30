'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const service = require('./pagamentos.service');
const { entregarExportacao } = require('../../_comum/exportacao');
const { resolverPerfil } = require('../../_comum/politica-acesso');
const { contaDaRequisicao } = require('../../_comum/conta');

/** O DTO do service é idêntico ao da B; aqui só entra o envelope da A. */
module.exports = {
  /** GET /recebimentos/export: o recorte inteiro em .xlsx (R23). Grava `operations.export.download` antes; sem a linha, 503 e sem arquivo. */
  exportar: catchAsyncRoute(async (req, res) => {
    const exportacao = await service.exportar(req.query || {});
    return entregarExportacao(res, { accountId: contaDaRequisicao(req), role: resolverPerfil(req) }, exportacao);
  }),
  listar: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.listar(req.query || {}), 'Recebimentos do legado.', 200)),
  listarSemDataPaga: catchAsyncRoute(async (req, res) => responderSucesso(res, await service.listarSemDataPaga(req.query || {}), 'Recebimentos sem data paga.', 200)),
};
