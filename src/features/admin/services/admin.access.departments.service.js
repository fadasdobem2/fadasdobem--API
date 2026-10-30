'use strict';

const { Op } = require('sequelize');
const { AccessDepartment, AccessPermission, StaffProfile } = require('../../../models');
const AppError = require('../../../utils/AppError');
const { persistAdminAuditLog } = require('../helpers/adminAudit.helper');
const { nivelDe, isDepartmentEligible } = require('../../../rbac/rbac.constants');
const { invalidateAllAccessCache } = require('../../../rbac/authorization.service');
const { httpCtxNormalize, slugifyId, setorToFront, permissionsRecord } = require('./admin.access.shared');

async function listDepartments() {
  const rows = await AccessDepartment.findAll({
    order: [['nome', 'ASC']],
    include: [{ model: AccessPermission, as: 'permissions', required: false }],
  });
  return rows.map(setorToFront);
}

async function createDepartment(actorId, body = {}, httpCtx = {}) {
  const nome = `${body.nome || ''}`.trim();
  if (!nome) throw new AppError('Informe o nome do setor.', 400, null, true);
  const id = body.id ? `${body.id}`.trim().slice(0, 64) : slugifyId(nome, 's');

  const dept = await AccessDepartment.create({
    id,
    nome,
    descricao: `${body.descricao || body.desc || ''}`.trim() || null,
    icone: `${body.icone || body.ico || 'ph-squares-four'}`.trim(),
    cor: `${body.cor || 'v-blue'}`.trim(),
    ativo: true,
  });

  if (body.perms) {
    await setDepartmentPermissions(actorId, id, { perms: body.perms }, httpCtx);
  }

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_DEPARTMENT_CREATE',
    target_entity: 'AccessDepartment',
    new_value: { id: dept.id, nome: dept.nome },
    httpCtx: httpCtxNormalize(httpCtx),
  });

  invalidateAllAccessCache();
  return setorToFront(
    await AccessDepartment.findByPk(id, {
      include: [{ model: AccessPermission, as: 'permissions' }],
    })
  );
}

async function updateDepartment(actorId, id, body = {}, httpCtx = {}) {
  const dept = await AccessDepartment.findByPk(id, {
    include: [{ model: AccessPermission, as: 'permissions' }],
  });
  if (!dept) throw new AppError('Setor não encontrado.', 404, null, true);

  const oldSnap = dept.get({ plain: true });
  const updates = {};
  if (body.nome != null) updates.nome = `${body.nome}`.trim();
  if (body.descricao != null || body.desc != null) {
    updates.descricao = `${body.descricao ?? body.desc ?? ''}`.trim() || null;
  }
  if (body.icone != null || body.ico != null) updates.icone = `${body.icone ?? body.ico}`.trim();
  if (body.cor != null) updates.cor = `${body.cor}`.trim();
  if (body.ativo != null) updates.ativo = !!body.ativo;
  if (body.off != null) updates.ativo = !body.off;

  await dept.update(updates);
  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_DEPARTMENT_UPDATE',
    target_entity: 'AccessDepartment',
    old_value: oldSnap,
    new_value: { ...oldSnap, ...updates },
    httpCtx: httpCtxNormalize(httpCtx),
    metadata: { department_id: id },
  });

  invalidateAllAccessCache();
  return setorToFront(await AccessDepartment.findByPk(id, {
    include: [{ model: AccessPermission, as: 'permissions' }],
  }));
}

async function softDeleteDepartment(actorId, id, httpCtx = {}) {
  const dept = await AccessDepartment.findByPk(id);
  if (!dept) throw new AppError('Setor não encontrado.', 404, null, true);

  const members = await StaffProfile.count({ where: { department_id: id } });
  if (members > 0) {
    throw new AppError('Transfira as pessoas deste setor antes de excluí-lo.', 409, null, true);
  }

  await dept.update({ ativo: false });
  await dept.destroy();
  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_DEPARTMENT_DELETE',
    target_entity: 'AccessDepartment',
    old_value: dept.get({ plain: true }),
    httpCtx: httpCtxNormalize(httpCtx),
    metadata: { department_id: id },
  });

  invalidateAllAccessCache();
  return { id, deleted: true };
}

async function setDepartmentPermissions(actorId, id, body = {}, httpCtx = {}) {
  const dept = await AccessDepartment.findByPk(id, {
    include: [{ model: AccessPermission, as: 'permissions' }],
  });
  if (!dept) throw new AppError('Setor não encontrado.', 404, null, true);

  const permsInput = body.perms ?? body.permissions ?? body.chaves;
  const chaves = [];
  if (Array.isArray(permsInput)) {
    chaves.push(...permsInput);
  } else if (permsInput && typeof permsInput === 'object') {
    for (const [k, v] of Object.entries(permsInput)) {
      if (v && isDepartmentEligible(nivelDe(k))) chaves.push(k);
    }
  }

  const rows = await AccessPermission.findAll({
    where: { chave: { [Op.in]: chaves }, ativo: true },
  });
  const permIds = rows.filter((p) => isDepartmentEligible(p.nivel)).map((p) => p.id);

  const oldSnap = permissionsRecord(dept.permissions);
  await dept.setPermissions(permIds);
  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_DEPARTMENT_SET_PERMISSIONS',
    target_entity: 'AccessDepartment',
    old_value: { perms: oldSnap },
    new_value: { perms: permsInput },
    httpCtx: httpCtxNormalize(httpCtx),
    metadata: { department_id: id },
  });

  invalidateAllAccessCache();
  return setorToFront(await AccessDepartment.findByPk(id, {
    include: [{ model: AccessPermission, as: 'permissions' }],
  }));
}

module.exports = {
  listDepartments,
  createDepartment,
  updateDepartment,
  softDeleteDepartment,
  setDepartmentPermissions,
};
