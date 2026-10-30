'use strict';

const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const service = require('./job-applications.service');

module.exports = {
  list: catchAsyncRoute(async (req, res) => {
    const dados = await service.listJobsAdmin(req.query || {});
    return responderSucesso(res, dados, 'Candidaturas (outras áreas).', 200);
  }),

  getById: catchAsyncRoute(async (req, res) => {
    const dados = await service.getJobAdmin(req.params.id);
    return responderSucesso(res, dados, 'Ficha da candidatura.', 200);
  }),

  patchEstado: catchAsyncRoute(async (req, res) => {
    const dados = await service.patchJobEstado(req.user.id, req.params.id, req.body || {});
    return responderSucesso(res, dados, 'Estado actualizado.', 200);
  }),
};
