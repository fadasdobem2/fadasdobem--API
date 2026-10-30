'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const accessService = require('../services/admin.access.service');
const impactService = require('../services/admin.access-impact.service');
const staffCandidatesService = require('../services/admin.staff-candidates.service');
const staffInviteService = require('../../../rbac/staff-invite.service');
const { getRouteRegistry } = require('../../../rbac/rbac.route-registry');
const { loadUserAccessContext } = require('../../../rbac/authorization.service');

function httpCtx(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress,
    user_agent: req.headers['user-agent'],
    correlation_id: req.headers['x-request-id'],
  };
}

module.exports = {
  meta: catchAsyncRoute(async (_req, res) => {
    const dados = await accessService.getMetaSnapshot();
    return responderSucesso(res, dados, 'Snapshot RBAC.', 200);
  }),

  me: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.getMyAccess(req.user.id);
    const ctx = await loadUserAccessContext(req.user.id);
    return responderSucesso(
      res,
      {
        ...dados,
        roles: ctx.roles.map((r) => ({ id: r.id, nome: r.nome })),
        staffStatus: ctx.staffStatus,
      },
      'Permissões efectivas da sessão.',
      200
    );
  }),

  check: catchAsyncRoute(async (req, res) => {
    const chaves = req.body?.chaves || req.body?.permissions || [];
    const dados = await accessService.checkPermissions(req.user.id, chaves);
    return responderSucesso(res, { permissions: dados }, 'Verificação de permissões.', 200);
  }),

  listRoles: catchAsyncRoute(async (_req, res) => {
    const dados = await accessService.listRoles();
    return responderSucesso(res, { items: dados }, 'Papéis listados.', 200);
  }),

  getRole: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.getRole(req.params.id);
    return responderSucesso(res, dados, 'Papel carregado.', 200);
  }),

  createRole: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.createRole(req.user.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Papel criado.', 201);
  }),

  updateRole: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.updateRole(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Papel actualizado.', 200);
  }),

  deleteRole: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.softDeleteRole(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Papel removido.', 200);
  }),

  setRolePermissions: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.setRolePermissions(
      req.user.id,
      req.params.id,
      req.body || {},
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Permissões do papel actualizadas.', 200);
  }),

  listPermissions: catchAsyncRoute(async (_req, res) => {
    const dados = await accessService.listPermissions();
    return responderSucesso(res, { items: dados }, 'Permissões listadas.', 200);
  }),

  createPermission: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.createCustomPermission(req.user.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Permissão custom criada.', 201);
  }),

  updatePermission: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.updatePermission(
      req.user.id,
      req.params.id,
      req.body || {},
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Permissão actualizada.', 200);
  }),

  deletePermission: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.softDeletePermission(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Permissão removida.', 200);
  }),

  listDepartments: catchAsyncRoute(async (_req, res) => {
    const dados = await accessService.listDepartments();
    return responderSucesso(res, { items: dados }, 'Setores listados.', 200);
  }),

  createDepartment: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.createDepartment(req.user.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Setor criado.', 201);
  }),

  updateDepartment: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.updateDepartment(
      req.user.id,
      req.params.id,
      req.body || {},
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Setor actualizado.', 200);
  }),

  deleteDepartment: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.softDeleteDepartment(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Setor removido.', 200);
  }),

  setDepartmentPermissions: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.setDepartmentPermissions(
      req.user.id,
      req.params.id,
      req.body || {},
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Permissões do setor actualizadas.', 200);
  }),

  listJobTitles: catchAsyncRoute(async (_req, res) => {
    const dados = await accessService.listJobTitles();
    return responderSucesso(res, { items: dados }, 'Cargos listados.', 200);
  }),

  createJobTitle: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.createJobTitle(req.user.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Cargo criado.', 201);
  }),

  updateJobTitle: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.updateJobTitle(
      req.user.id,
      req.params.id,
      req.body || {},
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Cargo actualizado.', 200);
  }),

  deleteJobTitle: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.softDeleteJobTitle(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Cargo removido.', 200);
  }),

  listStaff: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.listStaff(req.query || {});
    return responderSucesso(res, { items: dados }, 'Equipa interna listada.', 200);
  }),

  getStaff: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.getStaff(req.params.id);
    return responderSucesso(res, dados, 'Utilizador interno carregado.', 200);
  }),

  getStaffHistory: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.getStaffHistory(req.params.id);
    return responderSucesso(res, dados, 'Histórico do utilizador carregado.', 200);
  }),

  createStaff: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.createStaff(req.user.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Convite de equipa criado.', 201);
  }),

  updateStaff: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.updateStaff(
      req.user.id,
      req.params.id,
      req.body || {},
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Utilizador interno actualizado.', 200);
  }),

  setStaffStatus: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.setStaffStatus(
      req.user.id,
      req.params.id,
      req.body || {},
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Status actualizado.', 200);
  }),

  setStaffRoles: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.setStaffRoles(
      req.user.id,
      req.params.id,
      req.body || {},
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Papéis actualizados.', 200);
  }),

  upsertException: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.upsertException(
      req.user.id,
      req.params.id,
      req.body || {},
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Exceção registada.', 200);
  }),

  removeException: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.removeException(
      req.user.id,
      req.params.id,
      req.params.exceptionId,
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Exceção removida.', 200);
  }),

  resendInvite: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.resendInvite(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Convite reenviado.', 200);
  }),

  resetStaffPassword: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.resetStaffPassword(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Link de redefinição de senha enviado.', 200);
  }),

  forceStaffPasswordChange: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.forceStaffPasswordChange(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Utilizador terá de redefinir a senha no próximo acesso.', 200);
  }),

  endStaffSessions: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.endStaffSessions(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Sessões encerradas.', 200);
  }),

  cancelStaffInvite: catchAsyncRoute(async (req, res) => {
    const dados = await accessService.cancelStaffInvite(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Convite cancelado.', 200);
  }),

  catalog: catchAsyncRoute(async (_req, res) => {
    const items = impactService.listPermissionCatalog();
    return responderSucesso(res, { items }, 'Catálogo de funções.', 200);
  }),

  registry: catchAsyncRoute(async (req, res) => {
    const includeFuture = `${req.query.future ?? 'true'}` !== 'false';
    const items = getRouteRegistry({ includeFuture });
    return responderSucesso(res, { items }, 'Registo rota→permissão.', 200);
  }),

  roleImpact: catchAsyncRoute(async (req, res) => {
    const dados = await impactService.getRoleImpact(req.params.id);
    return responderSucesso(res, dados, 'Impacto do papel.', 200);
  }),

  permissionImpact: catchAsyncRoute(async (req, res) => {
    const dados = await impactService.getPermissionImpact(req.params.chave);
    return responderSucesso(res, dados, 'Impacto da função.', 200);
  }),

  departmentImpact: catchAsyncRoute(async (req, res) => {
    const dados = await impactService.getDepartmentImpact(req.params.id);
    return responderSucesso(res, dados, 'Impacto do setor.', 200);
  }),

  listStaffCandidates: catchAsyncRoute(async (req, res) => {
    const items = await staffCandidatesService.listStaffCandidates(req.query || {});
    return responderSucesso(res, { items }, 'Candidatos internos listados.', 200);
  }),

  getStaffCandidate: catchAsyncRoute(async (req, res) => {
    const dados = await staffCandidatesService.getStaffCandidate(req.params.id);
    return responderSucesso(res, dados, 'Candidato carregado.', 200);
  }),

  createStaffCandidate: catchAsyncRoute(async (req, res) => {
    const dados = await staffCandidatesService.createStaffCandidate(
      req.user.id,
      req.body || {},
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Candidato adicionado ao funil.', 201);
  }),

  patchStaffCandidate: catchAsyncRoute(async (req, res) => {
    const candidate = await staffCandidatesService.updateStaffCandidate(
      req.user.id,
      req.params.id,
      req.body || {},
      httpCtx(req)
    );
    return responderSucesso(res, candidate, 'Candidato actualizado.', 200);
  }),

  startStaffCandidateAnalysis: catchAsyncRoute(async (req, res) => {
    const dados = await staffCandidatesService.startAnalysis(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Análise iniciada.', 200);
  }),

  addStaffCandidateObservation: catchAsyncRoute(async (req, res) => {
    const dados = await staffCandidatesService.addObservation(
      req.user.id,
      req.params.id,
      req.body?.texto ?? req.body?.obs,
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Observação adicionada.', 201);
  }),

  removeStaffCandidateObservation: catchAsyncRoute(async (req, res) => {
    const dados = await staffCandidatesService.removeObservation(
      req.user.id,
      req.params.id,
      req.params.index,
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Observação removida.', 200);
  }),

  setStaffCandidateContract: catchAsyncRoute(async (req, res) => {
    const dados = await staffCandidatesService.setContract(
      req.user.id,
      req.params.id,
      req.body || {},
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Contrato anexado.', 200);
  }),

  removeStaffCandidateContract: catchAsyncRoute(async (req, res) => {
    const dados = await staffCandidatesService.removeContract(req.user.id, req.params.id, httpCtx(req));
    return responderSucesso(res, dados, 'Contrato removido.', 200);
  }),

  convertCandidateToStaff: catchAsyncRoute(async (req, res) => {
    const dados = await staffCandidatesService.convertToStaff(
      req.user.id,
      req.params.id,
      req.body || {},
      httpCtx(req)
    );
    return responderSucesso(res, dados, 'Candidato convertido em utilizador interno.', 201);
  }),

  previewInvite: catchAsyncRoute(async (req, res) => {
    const token = req.query.token || req.body?.token;
    const dados = await staffInviteService.previewInvite(token);
    return responderSucesso(res, dados, 'Convite válido.', 200);
  }),

  acceptInvite: catchAsyncRoute(async (req, res) => {
    const dados = await staffInviteService.acceptStaffInvite(req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Convite aceite — pode iniciar sessão.', 200);
  }),
};
