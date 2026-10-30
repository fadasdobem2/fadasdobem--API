'use strict';

const { Op } = require('sequelize');
const {
  User,
  StaffProfile,
  AccessRole,
  AccessPermission,
  AccessDepartment,
  AccessJobTitle,
} = require('../../../models');
const AppError = require('../../../utils/AppError');
const { PERMISSION_AREAS } = require('../../../rbac/rbac.catalog');
const { resolvePermissionByIdOrChave } = require('../helpers/admin.access.helpers');

async function getRoleImpact(roleId) {
  const role = await AccessRole.findByPk(roleId, {
    include: [{ model: AccessPermission, as: 'permissions', required: false }],
  });
  if (!role) throw new AppError('Papel não encontrado.', 404, null, true);

  const users = await User.findAll({
    where: { role: { [Op.in]: ['GESTORA', 'ATENDENTE'] } },
    attributes: ['id', 'email'],
    include: [
      {
        model: AccessRole,
        as: 'access_roles',
        where: { id: roleId },
        required: true,
        attributes: [],
      },
      {
        model: StaffProfile,
        as: 'staff_profile',
        required: true,
        where: { staff_status: { [Op.ne]: 'desativado' } },
        attributes: ['display_name', 'staff_status'],
      },
    ],
  });

  const jobTitles = await AccessJobTitle.findAll({
    where: { default_role_id: roleId, ativo: true },
    attributes: ['id', 'nome'],
  });

  return {
    role: { id: role.id, nome: role.nome, ativo: role.ativo !== false },
    pessoas: users.map((u) => ({
      id: u.id,
      email: u.email,
      nome: u.staff_profile?.display_name || u.email,
      status: u.staff_profile?.staff_status,
    })),
    cargosPadrao: jobTitles.map((j) => ({ id: j.id, nome: j.nome })),
    permissoes: (role.permissions || []).length,
  };
}

async function getPermissionImpact(chaveOrId) {
  const perm = await resolvePermissionByIdOrChave(chaveOrId);
  if (!perm) throw new AppError('Função não encontrada.', 404, null, true);

  const roles = await AccessRole.findAll({
    where: { ativo: true },
    include: [
      {
        model: AccessPermission,
        as: 'permissions',
        where: { id: perm.id },
        required: true,
        attributes: [],
      },
    ],
    attributes: ['id', 'nome', 'all_access'],
  });

  const allAccessRoles = await AccessRole.findAll({
    where: { ativo: true, all_access: true },
    attributes: ['id', 'nome'],
  });

  const departments = await AccessDepartment.findAll({
    where: { ativo: true },
    include: [
      {
        model: AccessPermission,
        as: 'permissions',
        where: { id: perm.id },
        required: true,
        attributes: [],
      },
    ],
    attributes: ['id', 'nome'],
  });

  const roleList = [
    ...roles.map((r) => ({ id: r.id, nome: r.nome, via: 'papel' })),
    ...allAccessRoles
      .filter((r) => !roles.some((x) => x.id === r.id))
      .map((r) => ({ id: r.id, nome: r.nome, via: 'ALL' })),
  ];

  return {
    permissao: {
      chave: perm.chave,
      rotulo: perm.rotulo,
      nivel: perm.nivel,
      ativo: perm.ativo,
    },
    papeis: roleList,
    setores: departments.map((d) => ({ id: d.id, nome: d.nome })),
    totalPapeis: roleList.length,
    totalSetores: departments.length,
  };
}

async function getDepartmentImpact(departmentId) {
  const dept = await AccessDepartment.findByPk(departmentId, {
    include: [{ model: AccessPermission, as: 'permissions', required: false }],
  });
  if (!dept) throw new AppError('Setor não encontrado.', 404, null, true);

  const users = await User.findAll({
    where: { role: { [Op.in]: ['GESTORA', 'ATENDENTE'] } },
    attributes: ['id', 'email'],
    include: [
      {
        model: StaffProfile,
        as: 'staff_profile',
        required: true,
        where: { department_id: departmentId, staff_status: { [Op.ne]: 'desativado' } },
        attributes: ['display_name', 'staff_status'],
      },
    ],
  });

  return {
    setor: { id: dept.id, nome: dept.nome, ativo: dept.ativo !== false },
    pessoas: users.map((u) => ({
      id: u.id,
      email: u.email,
      nome: u.staff_profile?.display_name || u.email,
      status: u.staff_profile?.staff_status,
    })),
    funcoes: (dept.permissions || []).length,
  };
}

function listPermissionCatalog() {
  const items = [];
  for (const area of PERMISSION_AREAS) {
    for (const p of area.perms) {
      items.push({
        chave: p.id,
        rotulo: p.nome,
        descricao: p.desc || '',
        area: area.id,
        areaNome: area.nome,
      });
    }
  }
  return items;
}

module.exports = {
  getRoleImpact,
  getPermissionImpact,
  getDepartmentImpact,
  listPermissionCatalog,
};
