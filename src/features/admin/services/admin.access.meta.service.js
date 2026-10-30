'use strict';

const { Op } = require('sequelize');
const {
  User,
  AccessPermission,
  AccessRole,
  AccessDepartment,
  AccessJobTitle,
} = require('../../../models');
const { PERMISSION_AREAS } = require('../../../rbac/rbac.catalog');
const { loadUserAccessContext, podeMany } = require('../../../rbac/authorization.service');
const {
  roleToFront,
  setorToFront,
  cargoToFront,
  usuarioToFront,
  countRoleUsers,
  staffInclude,
} = require('./admin.access.shared');

async function buildAreasSnapshot() {
  const allDb = await AccessPermission.findAll({ order: [['chave', 'ASC']] });
  const dbByChave = new Map(allDb.map((p) => [p.chave, p]));
  const customByArea = new Map();

  for (const p of allDb.filter((row) => row.custom)) {
    if (!customByArea.has(p.area)) customByArea.set(p.area, []);
    customByArea.get(p.area).push({
      id: p.chave,
      nome: p.rotulo,
      desc: p.descricao || '',
      custom: true,
      dbId: p.id,
      off: !p.ativo,
    });
  }

  return PERMISSION_AREAS.map((area) => ({
    ...area,
    perms: [
      ...area.perms.map((p) => {
        const db = dbByChave.get(p.id);
        return {
          ...p,
          nome: db?.rotulo || p.nome,
          desc: db?.descricao || p.desc || '',
          off: db ? !db.ativo : false,
        };
      }),
      ...(customByArea.get(area.id) || []),
    ],
  }));
}

async function getMetaSnapshot() {
  const [roles, departments, jobTitles, staffUsers, areas] = await Promise.all([
    AccessRole.findAll({
      order: [['nome', 'ASC']],
      include: [{ model: AccessPermission, as: 'permissions', required: false }],
    }),
    AccessDepartment.findAll({
      order: [['nome', 'ASC']],
      include: [{ model: AccessPermission, as: 'permissions', required: false }],
    }),
    AccessJobTitle.findAll({ order: [['nome', 'ASC']] }),
    User.findAll({
      where: { role: { [Op.in]: ['GESTORA', 'ATENDENTE'] } },
      include: await staffInclude(),
      order: [['created_at', 'DESC']],
    }),
    buildAreasSnapshot(),
  ]);

  const roleCounts = {};
  for (const r of roles) {
    roleCounts[r.id] = await countRoleUsers(r.id);
  }

  return {
    areas,
    roles: roles.map((r) => roleToFront(r, roleCounts[r.id] || 0)),
    cargos: jobTitles.map(cargoToFront),
    setores: departments.map(setorToFront),
    usuarios: staffUsers.map(usuarioToFront),
  };
}

async function getMyAccess(userId) {
  const ctx = await loadUserAccessContext(userId);
  const allKeys = PERMISSION_AREAS.flatMap((a) => a.perms.map((p) => p.id));
  const custom = await AccessPermission.findAll({
    where: { custom: true, ativo: true },
    attributes: ['chave'],
  });
  for (const c of custom) allKeys.push(c.chave);

  const granted = await podeMany(userId, [...new Set(allKeys)]);
  return {
    userId,
    roleIds: ctx.roleIds,
    staffStatus: ctx.staffStatus,
    hasAllAccess: ctx.hasAllAccess,
    permissions: granted,
  };
}

async function checkPermissions(userId, chaves = []) {
  const keys = Array.isArray(chaves) ? chaves : [];
  return podeMany(userId, keys);
}

module.exports = {
  buildAreasSnapshot,
  getMetaSnapshot,
  getMyAccess,
  checkPermissions,
};
