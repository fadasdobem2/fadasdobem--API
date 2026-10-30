'use strict';

/**
 * Fachada do serviço de acesso (RBAC admin).
 *
 * O serviço foi dividido por entidade para manutenção/escala — este arquivo é
 * apenas o ponto de entrada público e re-exporta cada submódulo. Os controllers
 * continuam importando `admin.access.service` sem mudanças.
 *
 *   - admin.access.shared.js        → apresentadores/helpers/queries compartilhadas
 *   - admin.access.roles.service    → papéis (roles)
 *   - admin.access.permissions...   → permissões (catálogo + custom)
 *   - admin.access.departments...   → setores (departments)
 *   - admin.access.jobtitles...     → cargos (job titles)
 *   - admin.access.staff.service    → pessoas (staff) + convites + ações de conta
 *   - admin.access.meta.service     → snapshot geral, meu acesso, checagem
 */
const shared = require('./admin.access.shared');
const roles = require('./admin.access.roles.service');
const permissions = require('./admin.access.permissions.service');
const departments = require('./admin.access.departments.service');
const jobTitles = require('./admin.access.jobtitles.service');
const staff = require('./admin.access.staff.service');
const meta = require('./admin.access.meta.service');

module.exports = {
  // meta
  getMetaSnapshot: meta.getMetaSnapshot,
  getMyAccess: meta.getMyAccess,
  checkPermissions: meta.checkPermissions,
  // roles
  listRoles: roles.listRoles,
  getRole: roles.getRole,
  createRole: roles.createRole,
  updateRole: roles.updateRole,
  softDeleteRole: roles.softDeleteRole,
  setRolePermissions: roles.setRolePermissions,
  // permissions
  listPermissions: permissions.listPermissions,
  createCustomPermission: permissions.createCustomPermission,
  updatePermission: permissions.updatePermission,
  softDeletePermission: permissions.softDeletePermission,
  // departments
  listDepartments: departments.listDepartments,
  createDepartment: departments.createDepartment,
  updateDepartment: departments.updateDepartment,
  softDeleteDepartment: departments.softDeleteDepartment,
  setDepartmentPermissions: departments.setDepartmentPermissions,
  // job titles
  listJobTitles: jobTitles.listJobTitles,
  createJobTitle: jobTitles.createJobTitle,
  updateJobTitle: jobTitles.updateJobTitle,
  softDeleteJobTitle: jobTitles.softDeleteJobTitle,
  // staff
  listStaff: staff.listStaff,
  getStaff: staff.getStaff,
  getStaffHistory: staff.getStaffHistory,
  createStaff: staff.createStaff,
  updateStaff: staff.updateStaff,
  setStaffStatus: staff.setStaffStatus,
  setStaffRoles: staff.setStaffRoles,
  upsertException: staff.upsertException,
  removeException: staff.removeException,
  resendInvite: staff.resendInvite,
  resetStaffPassword: staff.resetStaffPassword,
  forceStaffPasswordChange: staff.forceStaffPasswordChange,
  endStaffSessions: staff.endStaffSessions,
  cancelStaffInvite: staff.cancelStaffInvite,
  // presenters (compat: importados por admin.access-impact / outros)
  roleToFront: shared.roleToFront,
  setorToFront: shared.setorToFront,
  cargoToFront: shared.cargoToFront,
  usuarioToFront: shared.usuarioToFront,
};
