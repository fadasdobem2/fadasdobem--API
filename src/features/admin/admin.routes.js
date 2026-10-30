'use strict';

const { Router } = require('express');
const authMiddleware = require('../../middlewares/auth.middleware');
const { requireStaffAccess, requirePermission, requireAnyPermission } = require('../../middlewares/authorization.middleware');

const adminMetricsController = require('./controllers/admin.metrics.controller');
const adminSpecialistsController = require('./controllers/admin.specialists.controller');
const adminFinanceController = require('./controllers/admin.finance.controller');
const adminUsersController = require('./controllers/admin.users.controller');
const adminRecoveryController = require('./controllers/admin.recovery.controller');
const adminAuditController = require('./controllers/admin.audit.controller');
const adminAccessController = require('./controllers/admin.access.controller');
const specialistCandidatesAdminRoutes = require('../specialist-candidates/specialist-candidates.admin.routes');
const jobApplicationsAdminRoutes = require('../job-applications/job-applications.admin.routes');

const { attachAccessContext } = require('../../middlewares/authorization.middleware');

const router = Router();

router.use(authMiddleware, requireStaffAccess, attachAccessContext);

/* --- Access / RBAC (papéis, permissões, departamentos, cargos, staff) --- */
/** Snapshot UI — qualquer staff autenticado (dados filtrados pelo motor pode()). */
router.get('/access/meta', adminAccessController.meta);
router.get('/access/me', adminAccessController.me);
router.post('/access/check', adminAccessController.check);
router.get('/access/catalog', adminAccessController.catalog);
router.get('/access/registry', requirePermission('auditoria.ver'), adminAccessController.registry);

router.get('/access/impact/roles/:id', requirePermission('papeis.editar'), adminAccessController.roleImpact);
router.get('/access/impact/permissions/:chave', requirePermission('papeis.editar'), adminAccessController.permissionImpact);
router.get('/access/impact/departments/:id', requirePermission('usuarios.editar'), adminAccessController.departmentImpact);

router.get('/access/roles', requirePermission('papeis.editar'), adminAccessController.listRoles);
router.post('/access/roles', requirePermission('papeis.criar'), adminAccessController.createRole);
router.get('/access/roles/:id', requirePermission('papeis.editar'), adminAccessController.getRole);
router.patch('/access/roles/:id', requirePermission('papeis.editar'), adminAccessController.updateRole);
router.delete('/access/roles/:id', requirePermission('papeis.excluir'), adminAccessController.deleteRole);
router.patch('/access/roles/:id/permissions', requirePermission('papeis.editar'), adminAccessController.setRolePermissions);

router.get('/access/permissions', requirePermission('papeis.editar'), adminAccessController.listPermissions);
router.post('/access/permissions', requirePermission('papeis.criar'), adminAccessController.createPermission);
router.patch('/access/permissions/:id', requirePermission('papeis.editar'), adminAccessController.updatePermission);
router.delete('/access/permissions/:id', requirePermission('papeis.excluir'), adminAccessController.deletePermission);

router.get('/access/departments', requirePermission('usuarios.editar'), adminAccessController.listDepartments);
router.post('/access/departments', requirePermission('usuarios.editar'), adminAccessController.createDepartment);
router.patch('/access/departments/:id', requirePermission('usuarios.editar'), adminAccessController.updateDepartment);
router.delete('/access/departments/:id', requirePermission('usuarios.editar'), adminAccessController.deleteDepartment);
router.patch('/access/departments/:id/permissions', requirePermission('usuarios.editar'), adminAccessController.setDepartmentPermissions);

router.get('/access/job-titles', requirePermission('usuarios.editar'), adminAccessController.listJobTitles);
router.post('/access/job-titles', requirePermission('usuarios.editar'), adminAccessController.createJobTitle);
router.patch('/access/job-titles/:id', requirePermission('usuarios.editar'), adminAccessController.updateJobTitle);
router.delete('/access/job-titles/:id', requirePermission('usuarios.editar'), adminAccessController.deleteJobTitle);

router.get('/access/staff', requirePermission('usuarios.editar'), adminAccessController.listStaff);
router.post('/access/staff', requirePermission('usuarios.criar'), adminAccessController.createStaff);
router.get('/access/staff/:id', requirePermission('usuarios.editar'), adminAccessController.getStaff);
router.get('/access/staff/:id/history', requirePermission('usuarios.editar'), adminAccessController.getStaffHistory);
router.patch('/access/staff/:id', requirePermission('usuarios.editar'), adminAccessController.updateStaff);
router.patch('/access/staff/:id/status', requirePermission('usuarios.excluir'), adminAccessController.setStaffStatus);
router.patch('/access/staff/:id/roles', requirePermission('usuarios.editar'), adminAccessController.setStaffRoles);
router.post('/access/staff/:id/exceptions', requirePermission('usuarios.editar'), adminAccessController.upsertException);
router.delete('/access/staff/:id/exceptions/:exceptionId', requirePermission('usuarios.editar'), adminAccessController.removeException);
router.post('/access/staff/:id/resend-invite', requirePermission('usuarios.criar'), adminAccessController.resendInvite);
router.post('/access/staff/:id/reset-password', requirePermission('usuarios.editar'), adminAccessController.resetStaffPassword);
router.post('/access/staff/:id/force-password-change', requirePermission('usuarios.editar'), adminAccessController.forceStaffPasswordChange);
router.post('/access/staff/:id/end-sessions', requirePermission('usuarios.editar'), adminAccessController.endStaffSessions);
router.post('/access/staff/:id/cancel-invite', requirePermission('usuarios.criar'), adminAccessController.cancelStaffInvite);

router.get('/access/staff-candidates', requirePermission('usuarios.editar'), adminAccessController.listStaffCandidates);
router.post('/access/staff-candidates', requirePermission('usuarios.criar'), adminAccessController.createStaffCandidate);
router.get('/access/staff-candidates/:id', requirePermission('usuarios.editar'), adminAccessController.getStaffCandidate);
router.patch('/access/staff-candidates/:id', requirePermission('usuarios.editar'), adminAccessController.patchStaffCandidate);
router.post('/access/staff-candidates/:id/start-analysis', requirePermission('usuarios.editar'), adminAccessController.startStaffCandidateAnalysis);
router.post('/access/staff-candidates/:id/observations', requirePermission('usuarios.editar'), adminAccessController.addStaffCandidateObservation);
router.delete('/access/staff-candidates/:id/observations/:index', requirePermission('usuarios.editar'), adminAccessController.removeStaffCandidateObservation);
router.post('/access/staff-candidates/:id/contract', requirePermission('usuarios.editar'), adminAccessController.setStaffCandidateContract);
router.delete('/access/staff-candidates/:id/contract', requirePermission('usuarios.editar'), adminAccessController.removeStaffCandidateContract);
router.post('/access/staff-candidates/:id/convert', requirePermission('usuarios.criar'), adminAccessController.convertCandidateToStaff);

router.get('/audit', requirePermission('auditoria.ver'), adminAuditController.list);

router.get('/metrics/dashboard', requirePermission('relatorios.ver'), adminMetricsController.dashboard);

router.get('/specialists/list', requirePermission('tarologas.ver'), adminSpecialistsController.list);
router.patch(
  '/specialists/approve/:id',
  requirePermission('tarologas.aprovar_cand'),
  adminSpecialistsController.patchApprove
);
/** @deprecated alias legado compatível */
router.patch(
  '/specialists/:id/approval',
  requirePermission('tarologas.aprovar_cand'),
  adminSpecialistsController.patchApprove
);
router.patch(
  '/specialists/ranking-boost/:id',
  requirePermission('tarologas.editar'),
  adminSpecialistsController.patchRankingBoost
);

router.use('/specialist-candidates', requireAnyPermission('tarologas.ver', 'tarologas.aprovar_cand'), specialistCandidatesAdminRoutes);
/** Alias legado — painel candidatas */
router.use('/tarologa-candidates', requireAnyPermission('tarologas.ver', 'tarologas.aprovar_cand'), specialistCandidatesAdminRoutes);

router.use('/job-applications', requirePermission('tarologas.aprovar_cand'), jobApplicationsAdminRoutes);

router.get('/finance/transactions', requirePermission('dinheiro.recebimentos'), adminFinanceController.transactions);
router.get('/finance/payouts', requirePermission('dinheiro.pagar_tarologas'), adminFinanceController.listPayouts);
router.patch('/finance/payouts/:id', requirePermission('dinheiro.pagar_tarologas'), adminFinanceController.markPayoutPaid);
router.post('/finance/payouts/:id/:action', requirePermission('dinheiro.pagar_tarologas'), adminFinanceController.payoutAction);
router.get('/finance/dashboard', requireAnyPermission('dinheiro.recebimentos', 'dinheiro.faturamento'), adminFinanceController.pulse);

router.get('/users/search', requirePermission('clientes.buscar'), adminUsersController.search);
router.patch('/users/block/:id', requirePermission('clientes.bloquear'), adminUsersController.patchBlock);
/** @deprecated alias legado compatível */
router.patch('/users/:id/block', requirePermission('clientes.bloquear'), adminUsersController.patchBlock);

/* --- Recuperação / sincronização de contas --- */
router.get('/recovery/list', requirePermission('clientes.buscar'), adminRecoveryController.list);
router.get('/recovery/:id/candidates', requirePermission('clientes.buscar'), adminRecoveryController.candidates);
router.get('/recovery/:id', requirePermission('clientes.buscar'), adminRecoveryController.detail);
router.patch('/recovery/:id/assign', requirePermission('clientes.editar'), adminRecoveryController.assign);
router.patch('/recovery/:id/stage', requirePermission('clientes.editar'), adminRecoveryController.updateStage);
router.patch('/recovery/:id/original-user', requirePermission('clientes.editar'), adminRecoveryController.setOriginalUser);
router.patch('/recovery/:id/notes', requirePermission('clientes.editar'), adminRecoveryController.updateNotes);
router.post('/recovery/:id/admin-message', requirePermission('clientes.editar'), adminRecoveryController.sendMessage);
router.post('/recovery/:id/mark-messages-read', requirePermission('clientes.editar'), adminRecoveryController.markRead);
router.post('/recovery/:id/sync', requirePermission('clientes.editar'), adminRecoveryController.sync);

module.exports = router;
