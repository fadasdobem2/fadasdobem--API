'use strict';

const { Op } = require('sequelize');
const { sequelize, AccessRole, AccessPermission } = require('../../../models');
const AppError = require('../../../utils/AppError');
const { persistAdminAuditLog } = require('../helpers/adminAudit.helper');
const { PROTECTED_SYSTEM_ROLES } = require('../../../rbac/rbac.constants');
const { invalidateAllAccessCache } = require('../../../rbac/authorization.service');
const {
  httpCtxNormalize,
  slugifyId,
  roleToFront,
  countRoleUsers,
  permissionsRecord,
} = require('./admin.access.shared');

async function listRoles() {
  const roles = await AccessRole.findAll({
    order: [['nome', 'ASC']],
    include: [{ model: AccessPermission, as: 'permissions', required: false }],
  });
  const out = [];
  for (const r of roles) {
    out.push(roleToFront(r, await countRoleUsers(r.id)));
  }
  return out;
}

async function getRole(id) {
  const role = await AccessRole.findByPk(id, {
    include: [{ model: AccessPermission, as: 'permissions', required: false }],
  });
  if (!role) throw new AppError('Papel não encontrado.', 404, null, true);
  return roleToFront(role, await countRoleUsers(id));
}

async function createRole(actorId, body = {}, httpCtx = {}) {
  const nome = `${body.nome || ''}`.trim();
  if (!nome) throw new AppError('Informe o nome do papel.', 400, null, true);

  const id = body.id ? `${body.id}`.trim().slice(0, 64) : slugifyId(nome, 'papel_');

  return sequelize.transaction(async (t) => {
    let role = await AccessRole.findByPk(id, { transaction: t, paranoid: false });

    const payload = {
      nome,
      descricao: `${body.descricao || body.desc || ''}`.trim() || null,
      icone: `${body.icone || body.ico || 'ph-user-gear'}`.trim(),
      cor_gradient: body.cor_gradient || body.g || null,
      all_access: !!body.all_access,
      sistema: false,
      ativo: true,
    };

    if (role) {
      if (!role.deleted_at) {
        throw new AppError('Já existe um papel com este identificador.', 409, null, true);
      }
      await role.restore({ transaction: t });
      await role.update(payload, { transaction: t });
    } else {
      role = await AccessRole.create({ id, ...payload }, { transaction: t });
    }

    await persistAdminAuditLog(
      {
        admin_id: actorId,
        action: 'ACCESS_ROLE_CREATE',
        target_entity: 'AccessRole',
        target_id: null,
        new_value: { id: role.id, nome: role.nome },
        httpCtx: httpCtxNormalize(httpCtx),
        metadata: { role_id: role.id },
      },
      { transaction: t }
    );

    invalidateAllAccessCache();
    return getRole(role.id);
  });
}

async function updateRole(actorId, id, body = {}, httpCtx = {}) {
  const role = await AccessRole.findByPk(id);
  if (!role) throw new AppError('Papel não encontrado.', 404, null, true);
  if (PROTECTED_SYSTEM_ROLES.has(id) && body.all_access === false) {
    throw new AppError('Papel Admin não pode perder acesso total.', 403, null, true);
  }

  const oldSnap = role.get({ plain: true });
  const updates = {};
  if (body.nome != null) updates.nome = `${body.nome}`.trim();
  if (body.descricao != null || body.desc != null) {
    updates.descricao = `${body.descricao ?? body.desc ?? ''}`.trim() || null;
  }
  if (body.icone != null || body.ico != null) {
    updates.icone = `${body.icone ?? body.ico}`.trim();
  }
  if (body.cor_gradient != null || body.g != null) {
    updates.cor_gradient = body.cor_gradient ?? body.g ?? null;
  }
  if (body.ativo != null) updates.ativo = !!body.ativo;
  if (body.off != null) updates.ativo = !body.off;
  if (body.all_access != null) updates.all_access = !!body.all_access;

  if (role.sistema && (updates.ativo === false || body.off === true)) {
    throw new AppError('Papéis do sistema não podem ser desactivados.', 403, null, true);
  }

  await sequelize.transaction(async (t) => {
    await role.update(updates, { transaction: t });
    await persistAdminAuditLog(
      {
        admin_id: actorId,
        action: 'ACCESS_ROLE_UPDATE',
        target_entity: 'AccessRole',
        old_value: oldSnap,
        new_value: { ...oldSnap, ...updates },
        httpCtx: httpCtxNormalize(httpCtx),
        metadata: { role_id: id },
      },
      { transaction: t }
    );
  });

  invalidateAllAccessCache();
  return getRole(id);
}

async function softDeleteRole(actorId, id, httpCtx = {}) {
  if (PROTECTED_SYSTEM_ROLES.has(id)) {
    throw new AppError('Papel Admin não pode ser excluído.', 403, null, true);
  }
  const role = await AccessRole.findByPk(id);
  if (!role) throw new AppError('Papel não encontrado.', 404, null, true);

  const usersCount = await countRoleUsers(id);
  if (usersCount > 0) {
    throw new AppError('Remova o papel das pessoas antes de excluí-lo.', 409, null, true);
  }

  await sequelize.transaction(async (t) => {
    await role.update({ ativo: false }, { transaction: t });
    await role.destroy({ transaction: t });
    await persistAdminAuditLog(
      {
        admin_id: actorId,
        action: 'ACCESS_ROLE_DELETE',
        target_entity: 'AccessRole',
        old_value: role.get({ plain: true }),
        httpCtx: httpCtxNormalize(httpCtx),
        metadata: { role_id: id },
      },
      { transaction: t }
    );
  });

  invalidateAllAccessCache();
  return { id, deleted: true };
}

async function setRolePermissions(actorId, id, body = {}, httpCtx = {}) {
  const role = await AccessRole.findByPk(id, {
    include: [{ model: AccessPermission, as: 'permissions' }],
  });
  if (!role) throw new AppError('Papel não encontrado.', 404, null, true);

  const permsInput = body.perms ?? body.permissions ?? body.chaves;
  let permIds = [];

  if (permsInput === 'ALL') {
    if (!PROTECTED_SYSTEM_ROLES.has(id)) {
      await role.update({ all_access: true });
    }
    const all = await AccessPermission.findAll({ where: { ativo: true }, attributes: ['id'] });
    permIds = all.map((p) => p.id);
  } else {
    await role.update({ all_access: false });
    const chaves = [];
    if (Array.isArray(permsInput)) {
      chaves.push(...permsInput);
    } else if (permsInput && typeof permsInput === 'object') {
      for (const [k, v] of Object.entries(permsInput)) {
        if (v) chaves.push(k);
      }
    }
    const rows = await AccessPermission.findAll({
      where: { chave: { [Op.in]: chaves }, ativo: true },
    });
    permIds = rows.map((p) => p.id);
  }

  const oldSnap = permissionsRecord(role.permissions);

  await sequelize.transaction(async (t) => {
    await role.setPermissions(permIds, { transaction: t });
    await persistAdminAuditLog(
      {
        admin_id: actorId,
        action: 'ACCESS_ROLE_SET_PERMISSIONS',
        target_entity: 'AccessRole',
        old_value: { perms: oldSnap },
        new_value: { perms: permsInput },
        httpCtx: httpCtxNormalize(httpCtx),
        metadata: { role_id: id },
      },
      { transaction: t }
    );
  });

  invalidateAllAccessCache();
  return getRole(id);
}

module.exports = {
  listRoles,
  getRole,
  createRole,
  updateRole,
  softDeleteRole,
  setRolePermissions,
};
