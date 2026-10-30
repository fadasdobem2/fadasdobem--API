'use strict';

const { AccessJobTitle, AccessRole, StaffProfile } = require('../../../models');
const AppError = require('../../../utils/AppError');
const { persistAdminAuditLog } = require('../helpers/adminAudit.helper');
const { httpCtxNormalize, slugifyId, cargoToFront } = require('./admin.access.shared');

async function listJobTitles() {
  const rows = await AccessJobTitle.findAll({ order: [['nome', 'ASC']] });
  return rows.map(cargoToFront);
}

async function createJobTitle(actorId, body = {}, httpCtx = {}) {
  const nome = `${body.nome || ''}`.trim();
  const papel = `${body.default_role_id || body.papel || ''}`.trim();
  if (!nome || !papel) throw new AppError('Informe nome e papel padrão.', 400, null, true);

  const role = await AccessRole.findByPk(papel);
  if (!role) throw new AppError('Papel padrão inválido.', 400, null, true);

  const id = body.id ? `${body.id}`.trim().slice(0, 64) : slugifyId(nome, 'cg');
  const row = await AccessJobTitle.create({
    id,
    nome,
    descricao: `${body.descricao || body.desc || ''}`.trim() || null,
    default_role_id: papel,
    icone: `${body.icone || body.ico || 'ph-identification-badge'}`.trim(),
    cor: `${body.cor || 'v-gold'}`.trim(),
    ativo: true,
  });

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_JOB_TITLE_CREATE',
    target_entity: 'AccessJobTitle',
    new_value: { id: row.id, nome: row.nome },
    httpCtx: httpCtxNormalize(httpCtx),
  });

  return cargoToFront(row);
}

async function updateJobTitle(actorId, id, body = {}, httpCtx = {}) {
  const row = await AccessJobTitle.findByPk(id);
  if (!row) throw new AppError('Cargo não encontrado.', 404, null, true);

  const updates = {};
  if (body.nome != null) updates.nome = `${body.nome}`.trim();
  if (body.descricao != null || body.desc != null) {
    updates.descricao = `${body.descricao ?? body.desc ?? ''}`.trim() || null;
  }
  if (body.default_role_id != null || body.papel != null) {
    const papel = `${body.default_role_id ?? body.papel}`.trim();
    const role = await AccessRole.findByPk(papel);
    if (!role) throw new AppError('Papel padrão inválido.', 400, null, true);
    updates.default_role_id = papel;
  }
  if (body.icone != null || body.ico != null) updates.icone = `${body.icone ?? body.ico}`.trim();
  if (body.cor != null) updates.cor = `${body.cor}`.trim();
  if (body.ativo != null) updates.ativo = !!body.ativo;
  if (body.off != null) updates.ativo = !body.off;

  const oldSnap = row.get({ plain: true });
  await row.update(updates);
  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_JOB_TITLE_UPDATE',
    target_entity: 'AccessJobTitle',
    old_value: oldSnap,
    new_value: { ...oldSnap, ...updates },
    httpCtx: httpCtxNormalize(httpCtx),
    metadata: { job_title_id: id },
  });

  return cargoToFront(row);
}

async function softDeleteJobTitle(actorId, id, httpCtx = {}) {
  const row = await AccessJobTitle.findByPk(id);
  if (!row) throw new AppError('Cargo não encontrado.', 404, null, true);

  const members = await StaffProfile.count({ where: { job_title_id: id } });
  if (members > 0) {
    throw new AppError('Transfira as pessoas deste cargo antes de excluí-lo.', 409, null, true);
  }

  await row.update({ ativo: false });
  await row.destroy();
  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_JOB_TITLE_DELETE',
    target_entity: 'AccessJobTitle',
    old_value: row.get({ plain: true }),
    httpCtx: httpCtxNormalize(httpCtx),
    metadata: { job_title_id: id },
  });

  return { id, deleted: true };
}

module.exports = {
  listJobTitles,
  createJobTitle,
  updateJobTitle,
  softDeleteJobTitle,
};
