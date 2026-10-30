'use strict';

const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');
const service = require('./specialist-candidates.service');

function httpCtx(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress,
    user_agent: req.headers['user-agent'],
    correlation_id: req.headers['x-request-id'],
  };
}

module.exports = {
  list: catchAsyncRoute(async (req, res) => {
    const dados = await service.listCandidatesAdmin(req.query || {});
    return responderSucesso(res, dados, 'Lista de candidatas.', 200);
  }),

  summary: catchAsyncRoute(async (req, res) => {
    const dados = await service.summaryCandidatesAdmin();
    return responderSucesso(res, dados, 'Resumo do funil.', 200);
  }),

  getById: catchAsyncRoute(async (req, res) => {
    const dados = await service.getCandidateAdmin(req.params.id);
    return responderSucesso(res, dados, 'Ficha da candidata.', 200);
  }),

  create: catchAsyncRoute(async (req, res) => {
    const dados = await service.createCandidateManual(req.user.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Candidata cadastrada.', 201);
  }),

  patch: catchAsyncRoute(async (req, res) => {
    const dados = await service.patchCandidateAdmin(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Candidata actualizada.', 200);
  }),

  patchEstado: catchAsyncRoute(async (req, res) => {
    const dados = await service.patchCandidateEstado(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Estado actualizado.', 200);
  }),

  patchEspera: catchAsyncRoute(async (req, res) => {
    const dados = await service.patchCandidateEspera(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Espera actualizada.', 200);
  }),

  patchDecisao: catchAsyncRoute(async (req, res) => {
    const dados = await service.patchCandidateDecisao(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Decisão registada.', 200);
  }),

  reabrir: catchAsyncRoute(async (req, res) => {
    const dados = await service.reabrirCandidate(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Candidatura reaberta.', 200);
  }),

  convite: catchAsyncRoute(async (req, res) => {
    const dados = await service.enviarConvite(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Convite registado.', 200);
  }),

  marcarF2: catchAsyncRoute(async (req, res) => {
    const dados = await service.marcarF2Recebido(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'F2 marcado como recebido.', 200);
  }),

  gerarPerfil: catchAsyncRoute(async (req, res) => {
    const dados = await service.gerarPerfil(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Perfil gerado.', 200);
  }),

  liberarAcesso: catchAsyncRoute(async (req, res) => {
    const dados = await service.liberarAcesso(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Acesso liberado.', 200);
  }),

  ativar: catchAsyncRoute(async (req, res) => {
    const dados = await service.ativarPerfil(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Perfil activado na vitrine.', 200);
  }),

  upload: catchAsyncRoute(async (req, res) => {
    const dados = await service.uploadCandidateAsset(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Upload registado.', 200);
  }),

  removeContrato: catchAsyncRoute(async (req, res) => {
    const dados = await service.removeContrato(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Contrato removido.', 200);
  }),

  toggleFoto: catchAsyncRoute(async (req, res) => {
    const dados = await service.toggleFoto(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Foto actualizada.', 200);
  }),

  putPerfilPublico: catchAsyncRoute(async (req, res) => {
    const dados = await service.updateWizardSection(req.user.id, req.params.id, 'perfil-publico', req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Perfil público guardado.', 200);
  }),

  putCadastroPrivado: catchAsyncRoute(async (req, res) => {
    const dados = await service.updateWizardSection(req.user.id, req.params.id, 'cadastro-privado', req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Cadastro privado guardado.', 200);
  }),

  putPagamento: catchAsyncRoute(async (req, res) => {
    const dados = await service.updateWizardSection(req.user.id, req.params.id, 'pagamento', req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Pagamento guardado.', 200);
  }),

  iniciarProcesso: catchAsyncRoute(async (req, res) => {
    const dados = await service.iniciarProcesso(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Processo seletivo iniciado.', 200);
  }),
};
