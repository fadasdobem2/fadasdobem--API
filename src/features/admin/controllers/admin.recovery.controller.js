'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const recoveryService = require('../services/admin.recovery.service');

function httpCtx(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress,
    user_agent: req.headers['user-agent'],
    correlation_id: req.headers['x-request-id'],
  };
}

module.exports = {
  /** GET /admin/recovery/list */
  list: catchAsyncRoute(async (req, res) => {
    const dados = await recoveryService.listRecoveryRequests(req.query || {});
    return responderSucesso(res, dados, 'Lista de solicitações de recuperação.', 200);
  }),

  /** GET /admin/recovery/:id/candidates */
  candidates: catchAsyncRoute(async (req, res) => {
    const dados = await recoveryService.findOriginalUserCandidates(req.params.id, req.query || {});
    return responderSucesso(res, dados, 'Candidatos para conta original.', 200);
  }),

  /** GET /admin/recovery/:id */
  detail: catchAsyncRoute(async (req, res) => {
    const dados = await recoveryService.getRecoveryRequestDetail(req.params.id);
    return responderSucesso(res, dados, 'Detalhe da solicitação de recuperação.', 200);
  }),

  /** PATCH /admin/recovery/:id/assign */
  assign: catchAsyncRoute(async (req, res) => {
    const dados = await recoveryService.assignAdmin(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Admin atribuído à solicitação.', 200);
  }),

  /** PATCH /admin/recovery/:id/stage */
  updateStage: catchAsyncRoute(async (req, res) => {
    const dados = await recoveryService.updateStage(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Etapa da solicitação atualizada.', 200);
  }),

  /** PATCH /admin/recovery/:id/original-user */
  setOriginalUser: catchAsyncRoute(async (req, res) => {
    const dados = await recoveryService.setOriginalUser(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Conta original definida.', 200);
  }),

  /** PATCH /admin/recovery/:id/notes */
  updateNotes: catchAsyncRoute(async (req, res) => {
    const dados = await recoveryService.updateNotes(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Notas internas atualizadas.', 200);
  }),

  /** POST /admin/recovery/:id/admin-message */
  sendMessage: catchAsyncRoute(async (req, res) => {
    const dados = await recoveryService.sendAdminMessage(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Mensagem enviada ao usuário.', 201);
  }),

  /** POST /admin/recovery/:id/mark-messages-read */
  markRead: catchAsyncRoute(async (req, res) => {
    const dados = await recoveryService.markMessagesRead(req.user.id, req.params.id);
    return responderSucesso(res, dados, 'Mensagens marcadas como lidas.', 200);
  }),

  /** POST /admin/recovery/:id/sync */
  sync: catchAsyncRoute(async (req, res) => {
    const dados = await recoveryService.syncAccounts(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Contas sincronizadas com sucesso.', 200);
  }),
};
