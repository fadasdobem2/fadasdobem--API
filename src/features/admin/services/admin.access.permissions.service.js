'use strict';

const { AccessPermission } = require('../../../models');
const AppError = require('../../../utils/AppError');
const { persistAdminAuditLog } = require('../helpers/adminAudit.helper');
const { nivelDe } = require('../../../rbac/rbac.constants');
const { invalidateAllAccessCache } = require('../../../rbac/authorization.service');
const { resolvePermissionByIdOrChave } = require('../helpers/admin.access.helpers');
const { httpCtxNormalize } = require('./admin.access.shared');

async function listPermissions() {
  const rows = await AccessPermission.findAll({ order: [['area', 'ASC'], ['chave', 'ASC']] });
  return rows.map((p) => ({
    id: p.id,
    chave: p.chave,
    rotulo: p.rotulo,
    descricao: p.descricao,
    area: p.area,
    nivel: p.nivel,
    ativo: p.ativo,
    custom: p.custom,
  }));
}

async function createCustomPermission(actorId, body = {}, httpCtx = {}) {
  const chave = `${body.chave || body.id || ''}`.trim();
  const rotulo = `${body.rotulo || body.nome || ''}`.trim();
  const area = `${body.area || ''}`.trim();
  if (!chave || !rotulo || !area) {
    throw new AppError('Informe chave, rótulo e área.', 400, null, true);
  }

  const dup = await AccessPermission.findOne({ where: { chave }, paranoid: false });
  if (dup && !dup.deleted_at) {
    throw new AppError('Já existe uma permissão com esta chave.', 409, null, true);
  }

  const row = dup
    ? await dup.restore().then(() =>
        dup.update({
          rotulo,
          descricao: body.descricao || body.desc || null,
          area,
          nivel: nivelDe(chave),
          ativo: true,
          custom: true,
        })
      )
    : await AccessPermission.create({
        chave,
        rotulo,
        descricao: body.descricao || body.desc || null,
        area,
        nivel: body.nivel || nivelDe(chave),
        ativo: true,
        custom: true,
      });

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_PERMISSION_CREATE',
    target_entity: 'AccessPermission',
    new_value: { id: row.id, chave: row.chave },
    httpCtx: httpCtxNormalize(httpCtx),
  });

  invalidateAllAccessCache();
  return row;
}

async function updatePermission(actorId, id, body = {}, httpCtx = {}) {
  const perm = await resolvePermissionByIdOrChave(id);
  if (!perm) throw new AppError('Permissão não encontrada.', 404, null, true);

  const oldSnap = perm.get({ plain: true });
  const updates = {};
  if (body.rotulo != null || body.nome != null) updates.rotulo = `${body.rotulo ?? body.nome}`.trim();
  if (body.descricao != null || body.desc != null) {
    updates.descricao = `${body.descricao ?? body.desc ?? ''}`.trim() || null;
  }
  if (body.ativo != null) updates.ativo = !!body.ativo;
  if (body.off != null) updates.ativo = !body.off;

  await perm.update(updates);
  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_PERMISSION_UPDATE',
    target_entity: 'AccessPermission',
    old_value: oldSnap,
    new_value: { ...oldSnap, ...updates },
    httpCtx: httpCtxNormalize(httpCtx),
    metadata: { permission_id: id },
  });

  invalidateAllAccessCache();
  return perm;
}

async function softDeletePermission(actorId, id, httpCtx = {}) {
  const perm = await resolvePermissionByIdOrChave(id);
  if (!perm) throw new AppError('Permissão não encontrada.', 404, null, true);
  if (!perm.custom) {
    throw new AppError('Permissões do catálogo base não podem ser excluídas.', 403, null, true);
  }

  const oldSnap = perm.get({ plain: true });
  await perm.update({ ativo: false });
  await perm.destroy();
  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_PERMISSION_DELETE',
    target_entity: 'AccessPermission',
    old_value: oldSnap,
    httpCtx: httpCtxNormalize(httpCtx),
    metadata: { permission_id: id },
  });

  invalidateAllAccessCache();
  return { id, deleted: true };
}

module.exports = {
  listPermissions,
  createCustomPermission,
  updatePermission,
  softDeletePermission,
};
