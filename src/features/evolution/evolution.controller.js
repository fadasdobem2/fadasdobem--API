'use strict';

const evolutionService = require('./evolution.service');
const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');

const listInstances = catchAsyncRoute(async (_req, res) => {
  const snapshot = await evolutionService.summarizeInstancesSafe();
  return responderSucesso(res, { instancias: snapshot }, 'Instâncias resumidas com sucesso.', 200);
});

const reconnectInstance = catchAsyncRoute(async (req, res) => {
  const { instanceName } = req.params;
  const raw = await evolutionService.refreshQrArtifacts(instanceName);
  return responderSucesso(res, raw, 'Solicitação de reconexão disparada.', 202);
});

const probeIntegration = catchAsyncRoute(async (_req, res) => {
  const snapshot = await evolutionService.summarizeInstancesSafe();
  return responderSucesso(
    res,
    { alcancavel: true, resumoInstancias: snapshot },
    'Integração Evolution alcançada.',
    200
  );
});

module.exports = {
  listInstances,
  reconnectInstance,
  probeIntegration,
};
