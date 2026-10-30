'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  sequelize,
  User,
  StaffProfile,
  AccessPermission,
  AccessRole,
  AccessDepartment,
  AccessJobTitle,
  AccessUserException,
  AccessStaffInvite,
  AuditLog,
} = require('../../../models');
const AppError = require('../../../utils/AppError');
const { normalizeEmail } = require('../../auth/auth.constants');
const { persistAdminAuditLog } = require('../helpers/adminAudit.helper');
const {
  assertCanManageTarget,
  invalidateUserAccessCache,
} = require('../../../rbac/authorization.service');
const { assertAtLeastOneRootAdminRemains } = require('../../../rbac/rbac.root-admin.guard');
const { hashInviteToken: hashInviteTokenSvc } = require('../../../rbac/staff-invite.service');
const {
  httpCtxNormalize,
  initialsFromName,
  usuarioToFront,
  staffInclude,
} = require('./admin.access.shared');

const INVITE_TTL_DAYS = Number(process.env.STAFF_INVITE_TTL_DAYS || 7);

/** Título amigável por ação de auditoria (timeline do histórico da pessoa). */
const STAFF_HISTORY_TITLES = {
  ACCESS_STAFF_CREATE: 'Usuário criado',
  ACCESS_STAFF_UPDATE: 'Cadastro atualizado',
  ACCESS_STAFF_SET_STATUS: 'Status alterado',
  ACCESS_STAFF_SET_ROLES: 'Papéis definidos',
  ACCESS_STAFF_EXCEPTION_UPSERT: 'Permissão ajustada',
  ACCESS_STAFF_EXCEPTION_REMOVE: 'Exceção removida',
  ACCESS_STAFF_RESEND_INVITE: 'Convite enviado',
  ACCESS_STAFF_RESET_PASSWORD: 'Senha redefinida',
  ACCESS_STAFF_FORCE_PASSWORD: 'Troca de senha forçada',
  ACCESS_STAFF_END_SESSIONS: 'Sessões encerradas',
  ACCESS_STAFF_CANCEL_INVITE: 'Convite cancelado',
};

function staffHistoryDetail(action, plain) {
  const nv = plain.new_value || {};
  if (action === 'ACCESS_STAFF_SET_STATUS' && nv.status) {
    return `para “${nv.status}”${nv.motivo ? ` · ${nv.motivo}` : ''}`;
  }
  if (action === 'ACCESS_STAFF_EXCEPTION_UPSERT' && nv.chave) {
    return `${nv.granted ? 'liberou' : 'bloqueou'} ${nv.chave}`;
  }
  return '';
}

function generateInviteToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function hashInviteToken(token) {
  return hashInviteTokenSvc(token);
}

async function findStaffUserOrThrow(userId) {
  const user = await User.findByPk(userId, { include: await staffInclude() });
  if (!user?.staff_profile) {
    throw new AppError('Utilizador interno não encontrado.', 404, null, true);
  }
  return user;
}

async function listStaff(query = {}) {
  const profileWhere = {};
  if (query.status) {
    profileWhere.staff_status = `${query.status}`.trim();
  }

  const users = await User.findAll({
    where: { role: { [Op.in]: ['GESTORA', 'ATENDENTE'] } },
    include: [
      {
        model: StaffProfile,
        as: 'staff_profile',
        required: true,
        where: Object.keys(profileWhere).length ? profileWhere : undefined,
        include: [
          { model: AccessDepartment, as: 'access_department', required: false },
          { model: AccessJobTitle, as: 'access_job_title', required: false },
        ],
      },
      { model: AccessRole, as: 'access_roles', required: false },
      {
        model: AccessUserException,
        as: 'access_exceptions',
        required: false,
        include: [{ model: AccessPermission, as: 'permission', required: false }],
      },
    ],
    order: [['created_at', 'DESC']],
  });
  return users.map(usuarioToFront);
}

async function getStaff(userId) {
  const user = await findStaffUserOrThrow(userId);
  return usuarioToFront(user);
}

async function createStaff(actorId, body = {}, httpCtx = {}) {
  const email = normalizeEmail(body.email);
  if (!email) throw new AppError('Informe o e-mail institucional.', 400, null, true);

  const roleType = `${body.role || body.user_role || 'ATENDENTE'}`.trim().toUpperCase();
  if (!['ATENDENTE', 'GESTORA'].includes(roleType)) {
    throw new AppError('role deve ser ATENDENTE ou GESTORA.', 400, null, true);
  }

  const existing = await User.findOne({ where: { email }, paranoid: false });
  if (existing && !existing.deleted_at) {
    throw new AppError('Já existe um utilizador com este e-mail.', 409, null, true);
  }

  const displayName = `${body.nome || body.display_name || email.split('@')[0]}`.trim();
  const roleIds = Array.isArray(body.papeis)
    ? body.papeis
    : Array.isArray(body.role_ids)
      ? body.role_ids
      : body.papel
        ? [body.papel]
        : [];

  const departmentId = body.department_id || body.setorId || null;
  const jobTitleId = body.job_title_id || body.cargoId || null;
  const plainToken = generateInviteToken();
  const tokenHash = await hashInviteToken(plainToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);

  const result = await sequelize.transaction(async (t) => {
    const user = existing
      ? await existing.restore({ transaction: t }).then(() =>
          existing.update({ role: roleType, is_active: true, email_verified_at: null }, { transaction: t })
        )
      : await User.create(
          {
            email,
            role: roleType,
            password_hash: null,
            is_active: true,
          },
          { transaction: t }
        );

    let profile = await StaffProfile.findOne({ where: { user_id: user.id }, transaction: t, paranoid: false });
    const profileData = {
      user_id: user.id,
      display_name: displayName,
      department_id: departmentId,
      job_title_id: jobTitleId,
      staff_status: 'pendente',
      avatar_gradient: body.avatar_gradient || body.g || 'linear-gradient(135deg,#86a7bd,#51829b)',
      avatar_initials: body.avatar_initials || initialsFromName(displayName),
      vinculo: body.vinculo || null,
      personal_email: body.emailPessoal || body.personal_email || null,
      cpf: body.cpf || null,
      birth_date: body.nasc || body.birth_date || null,
      whatsapp: body.whats || body.whatsapp || null,
      whatsapp2: body.whats2 || body.whatsapp2 || null,
      address_json: {
        cep: body.cep || '',
        rua: body.rua || '',
        num: body.num || '',
        compl: body.compl || '',
        bairro: body.bairro || '',
        cidade: body.cidade || '',
        uf: body.uf || '',
      },
      payment_json: {
        pixTipo: body.pixTipo || '',
        pixChave: body.pixChave || '',
        banco: body.banco || '',
        ag: body.ag || '',
        conta: body.conta || '',
      },
      invited_at: new Date(),
    };

    if (!profile) {
      profile = await StaffProfile.create(profileData, { transaction: t });
    } else {
      if (profile.deleted_at) await profile.restore({ transaction: t });
      await profile.update(profileData, { transaction: t });
    }

    if (roleIds.length) {
      const roles = await AccessRole.findAll({ where: { id: { [Op.in]: roleIds } }, transaction: t });
      await user.setAccess_roles(roles, { transaction: t });
    }

    await AccessStaffInvite.create(
      {
        email,
        token_hash: tokenHash,
        user_id: user.id,
        department_id: departmentId,
        job_title_id: jobTitleId,
        role_ids: roleIds,
        expires_at: expiresAt,
        invited_by_id: actorId,
      },
      { transaction: t }
    );

    await persistAdminAuditLog(
      {
        admin_id: actorId,
        action: 'ACCESS_STAFF_CREATE',
        target_entity: 'User',
        target_id: user.id,
        new_value: { email, role: roleType, staff_status: 'pendente' },
        httpCtx: httpCtxNormalize(httpCtx),
      },
      { transaction: t }
    );

    return { user, inviteToken: plainToken };
  });

  invalidateUserAccessCache(result.user.id);
  const front = await getStaff(result.user.id);
  return { ...front, inviteToken: result.inviteToken };
}

async function updateStaff(actorId, userId, body = {}, httpCtx = {}) {
  await assertCanManageTarget(actorId, userId);
  const user = await findStaffUserOrThrow(userId);
  const profile = user.staff_profile;
  const oldSnap = usuarioToFront(user);

  const userUpdates = {};
  if (body.email != null) {
    const email = normalizeEmail(body.email);
    if (email) userUpdates.email = email;
  }
  if (body.role != null || body.user_role != null) {
    const r = `${body.role ?? body.user_role}`.trim().toUpperCase();
    if (['ATENDENTE', 'GESTORA'].includes(r)) userUpdates.role = r;
  }

  const profileUpdates = {};
  if (body.nome != null || body.display_name != null) {
    profileUpdates.display_name = `${body.nome ?? body.display_name}`.trim();
  }
  if (body.department_id != null || body.setorId != null) {
    profileUpdates.department_id = body.department_id ?? body.setorId;
  }
  if (body.job_title_id != null || body.cargoId != null) {
    profileUpdates.job_title_id = body.job_title_id ?? body.cargoId;
  }
  if (body.vinculo != null) profileUpdates.vinculo = body.vinculo;
  if (body.emailPessoal != null || body.personal_email != null) {
    profileUpdates.personal_email = body.emailPessoal ?? body.personal_email;
  }
  if (body.cpf != null) profileUpdates.cpf = body.cpf;
  if (body.nasc != null || body.birth_date != null) {
    profileUpdates.birth_date = body.nasc ?? body.birth_date;
  }
  if (body.whats != null || body.whatsapp != null) {
    profileUpdates.whatsapp = body.whats ?? body.whatsapp;
  }
  if (body.whats2 != null) profileUpdates.whatsapp2 = body.whats2;
  if (body.avatar_gradient != null || body.g != null) {
    profileUpdates.avatar_gradient = body.avatar_gradient ?? body.g;
  }

  const addrFields = ['cep', 'rua', 'num', 'compl', 'bairro', 'cidade', 'uf'];
  const addr = { ...(profile.address_json || {}) };
  let addrChanged = false;
  for (const f of addrFields) {
    if (body[f] != null) {
      addr[f] = body[f];
      addrChanged = true;
    }
  }
  if (addrChanged) profileUpdates.address_json = addr;

  const payFields = ['pixTipo', 'pixChave', 'banco', 'ag', 'conta'];
  const pay = { ...(profile.payment_json || {}) };
  let payChanged = false;
  for (const f of payFields) {
    if (body[f] != null) {
      pay[f] = body[f];
      payChanged = true;
    }
  }
  if (payChanged) profileUpdates.payment_json = pay;

  await sequelize.transaction(async (t) => {
    if (Object.keys(userUpdates).length) await user.update(userUpdates, { transaction: t });
    if (Object.keys(profileUpdates).length) await profile.update(profileUpdates, { transaction: t });
    await persistAdminAuditLog(
      {
        admin_id: actorId,
        action: 'ACCESS_STAFF_UPDATE',
        target_entity: 'User',
        target_id: userId,
        old_value: oldSnap,
        new_value: body,
        httpCtx: httpCtxNormalize(httpCtx),
      },
      { transaction: t }
    );
  });

  invalidateUserAccessCache(userId);
  return getStaff(userId);
}

async function setStaffStatus(actorId, userId, body = {}, httpCtx = {}) {
  await assertCanManageTarget(actorId, userId);
  const user = await findStaffUserOrThrow(userId);
  const status = `${body.status || body.staff_status || ''}`.trim();
  const allowed = ['ativo', 'pendente', 'expirado', 'suspenso', 'desativado', 'bloqueado'];
  if (!allowed.includes(status)) {
    throw new AppError('Status inválido.', 400, null, true);
  }

  if (status === 'desativado' || status === 'bloqueado') {
    await assertAtLeastOneRootAdminRemains({ userId, nextRoleIds: [] });
  }

  const oldStatus = user.staff_profile.staff_status;
  await user.staff_profile.update({ staff_status: status });

  if (status === 'desativado') {
    await user.update({ is_active: false });
  } else if (status === 'ativo') {
    await user.update({ is_active: true });
  }

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_SET_STATUS',
    target_entity: 'StaffProfile',
    target_id: user.staff_profile.id,
    old_value: { status: oldStatus },
    new_value: { status, motivo: body.motivo || null },
    httpCtx: httpCtxNormalize(httpCtx),
    metadata: { user_id: userId },
  });

  invalidateUserAccessCache(userId);
  return getStaff(userId);
}

async function setStaffRoles(actorId, userId, body = {}, httpCtx = {}) {
  await assertCanManageTarget(actorId, userId);
  const user = await findStaffUserOrThrow(userId);
  const roleIds = Array.isArray(body.papeis)
    ? body.papeis
    : Array.isArray(body.role_ids)
      ? body.role_ids
      : [];

  await assertAtLeastOneRootAdminRemains({ userId, nextRoleIds: roleIds });

  const roles = await AccessRole.findAll({ where: { id: { [Op.in]: roleIds } } });
  const oldIds = (user.access_roles || []).map((r) => r.id);
  await user.setAccess_roles(roles);

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_SET_ROLES',
    target_entity: 'User',
    target_id: userId,
    old_value: { papeis: oldIds },
    new_value: { papeis: roleIds },
    httpCtx: httpCtxNormalize(httpCtx),
  });

  invalidateUserAccessCache(userId);
  return getStaff(userId);
}

async function upsertException(actorId, userId, body = {}, httpCtx = {}) {
  await assertCanManageTarget(actorId, userId);
  const user = await findStaffUserOrThrow(userId);
  const chave = `${body.chave || body.permission || ''}`.trim();
  const granted = body.granted != null ? !!body.granted : !!body.enabled;
  const motivo = `${body.motivo || body.reason || ''}`.trim();
  if (!chave) throw new AppError('Informe a chave da permissão.', 400, null, true);
  if (!motivo) throw new AppError('Informe o motivo da exceção.', 400, null, true);

  const perm = await AccessPermission.findOne({ where: { chave, ativo: true } });
  if (!perm) throw new AppError('Permissão não encontrada.', 404, null, true);

  let row = await AccessUserException.findOne({
    where: { user_id: userId, permission_id: perm.id },
    paranoid: false,
  });

  if (row?.deleted_at) await row.restore();

  if (row) {
    await row.update({ granted, motivo, author_id: actorId });
  } else {
    row = await AccessUserException.create({
      user_id: userId,
      permission_id: perm.id,
      granted,
      motivo,
      author_id: actorId,
    });
  }

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_EXCEPTION_UPSERT',
    target_entity: 'AccessUserException',
    target_id: row.id,
    new_value: { user_id: userId, chave, granted, motivo },
    httpCtx: httpCtxNormalize(httpCtx),
    metadata: { user_id: userId },
  });

  invalidateUserAccessCache(userId);
  return getStaff(userId);
}

async function removeException(actorId, userId, exceptionId, httpCtx = {}) {
  await assertCanManageTarget(actorId, userId);
  const row = await AccessUserException.findOne({
    where: { id: exceptionId, user_id: userId },
  });
  if (!row) throw new AppError('Exceção não encontrada.', 404, null, true);

  await row.destroy();
  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_EXCEPTION_REMOVE',
    target_entity: 'AccessUserException',
    target_id: exceptionId,
    old_value: row.get({ plain: true }),
    httpCtx: httpCtxNormalize(httpCtx),
    metadata: { user_id: userId },
  });

  invalidateUserAccessCache(userId);
  return getStaff(userId);
}

async function resendInvite(actorId, userId, httpCtx = {}) {
  await assertCanManageTarget(actorId, userId);
  const user = await findStaffUserOrThrow(userId);
  const profile = user.staff_profile;

  if (!['pendente', 'expirado'].includes(profile.staff_status)) {
    throw new AppError('Convite só pode ser reenviado para contas pendentes ou expiradas.', 400, null, true);
  }

  const plainToken = generateInviteToken();
  const tokenHash = await hashInviteToken(plainToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  const roleIds = (user.access_roles || []).map((r) => r.id);

  await AccessStaffInvite.create({
    email: user.email,
    token_hash: tokenHash,
    user_id: user.id,
    department_id: profile.department_id,
    job_title_id: profile.job_title_id,
    role_ids: roleIds,
    expires_at: expiresAt,
    invited_by_id: actorId,
  });

  await profile.update({ staff_status: 'pendente', invited_at: new Date() });

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_RESEND_INVITE',
    target_entity: 'User',
    target_id: userId,
    httpCtx: httpCtxNormalize(httpCtx),
  });

  invalidateUserAccessCache(userId);
  return { ...(await getStaff(userId)), inviteToken: plainToken };
}

/**
 * Reset de senha disparado pelo admin: envia o OTP de redefinição por e-mail
 * ao utilizador interno. (g34 · "Resetar senha")
 */
async function resetStaffPassword(actorId, userId, httpCtx = {}) {
  await assertCanManageTarget(actorId, userId);
  const user = await findStaffUserOrThrow(userId);

  // eslint-disable-next-line global-require
  const authService = require('../../auth/auth.service');
  const result = await authService.adminTriggerPasswordReset(userId, {
    ip: httpCtx.ip,
    userAgent: httpCtx.userAgent || httpCtx.user_agent,
  });

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_RESET_PASSWORD',
    target_entity: 'User',
    target_id: userId,
    new_value: { channel: result.channel },
    httpCtx: httpCtxNormalize(httpCtx),
    metadata: { email: user.email },
  });

  return { ...(await getStaff(userId)), passwordReset: result };
}

/**
 * Força o utilizador a redefinir a senha no próximo acesso: liga a flag
 * `must_change_password` e revoga todas as sessões (obriga novo login).
 * (g34 · "Forçar troca de senha")
 */
async function forceStaffPasswordChange(actorId, userId, httpCtx = {}) {
  await assertCanManageTarget(actorId, userId);
  const user = await findStaffUserOrThrow(userId);

  await user.staff_profile.update({ must_change_password: true });

  // eslint-disable-next-line global-require
  const authService = require('../../auth/auth.service');
  await authService.revokeAllRefreshTokensForUser(userId);

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_FORCE_PASSWORD',
    target_entity: 'User',
    target_id: userId,
    new_value: { must_change_password: true },
    httpCtx: httpCtxNormalize(httpCtx),
  });

  invalidateUserAccessCache(userId);
  return getStaff(userId);
}

/**
 * Encerra todas as sessões ativas do utilizador (revoga refresh tokens).
 * (g34 · "Encerrar sessões")
 */
async function endStaffSessions(actorId, userId, httpCtx = {}) {
  await assertCanManageTarget(actorId, userId);
  await findStaffUserOrThrow(userId);

  // eslint-disable-next-line global-require
  const authService = require('../../auth/auth.service');
  await authService.revokeAllRefreshTokensForUser(userId);

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ACCESS_STAFF_END_SESSIONS',
    target_entity: 'User',
    target_id: userId,
    httpCtx: httpCtxNormalize(httpCtx),
  });

  invalidateUserAccessCache(userId);
  return getStaff(userId);
}

/**
 * Cancela um convite pendente/expirado: expira convites em aberto e remove
 * (soft-delete) a conta provisória. (g34 · "Cancelar convite")
 */
async function cancelStaffInvite(actorId, userId, httpCtx = {}) {
  await assertCanManageTarget(actorId, userId);
  const user = await findStaffUserOrThrow(userId);
  const profile = user.staff_profile;

  if (!['pendente', 'expirado'].includes(profile.staff_status)) {
    throw new AppError(
      'Só é possível cancelar convites de contas pendentes ou expiradas.',
      400,
      null,
      true
    );
  }

  await sequelize.transaction(async (t) => {
    await AccessStaffInvite.update(
      { expires_at: new Date() },
      { where: { user_id: userId, accepted_at: null }, transaction: t }
    );
    await profile.destroy({ transaction: t });
    await user.destroy({ transaction: t });

    await persistAdminAuditLog(
      {
        admin_id: actorId,
        action: 'ACCESS_STAFF_CANCEL_INVITE',
        target_entity: 'User',
        target_id: userId,
        old_value: { email: user.email, staff_status: profile.staff_status },
        httpCtx: httpCtxNormalize(httpCtx),
      },
      { transaction: t }
    );
  });

  // eslint-disable-next-line global-require
  const authService = require('../../auth/auth.service');
  await authService.revokeAllRefreshTokensForUser(userId);

  invalidateUserAccessCache(userId);
  return { ok: true, userId };
}

/**
 * Histórico (timeline) de uma pessoa: reúne os eventos de auditoria em que ela
 * é alvo — por `target_id` (create/update/roles/convites/senha/sessões) ou por
 * `metadata.user_id` (status/exceções). Retorna já formatado para a UI.
 */
async function getStaffHistory(userId) {
  await findStaffUserOrThrow(userId);

  const rows = await AuditLog.findAll({
    where: {
      action: { [Op.like]: 'ACCESS_STAFF%' },
      [Op.or]: [
        { target_id: `${userId}` },
        sequelize.where(sequelize.literal("metadata->>'user_id'"), `${userId}`),
      ],
    },
    include: [{ model: User, as: 'admin_user', required: false, attributes: ['id', 'email'] }],
    order: [['occurred_at', 'DESC']],
    limit: 100,
  });

  const items = rows
    .map((row) => row.get({ plain: true }))
    // exclui eventos do funil de candidatos (ACCESS_STAFF_CANDIDATE_*)
    .filter((p) => !p.action.startsWith('ACCESS_STAFF_CANDIDATE'))
    .map((p) => ({
      id: p.id,
      action: p.action,
      titulo: STAFF_HISTORY_TITLES[p.action] || p.action,
      detalhe: staffHistoryDetail(p.action, p),
      quem: p.admin_user?.email || null,
      ip: p.ip_address || null,
      quando: p.occurred_at,
    }));

  return { items };
}

module.exports = {
  listStaff,
  getStaff,
  getStaffHistory,
  createStaff,
  updateStaff,
  setStaffStatus,
  setStaffRoles,
  upsertException,
  removeException,
  resendInvite,
  resetStaffPassword,
  forceStaffPasswordChange,
  endStaffSessions,
  cancelStaffInvite,
};
