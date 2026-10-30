'use strict';

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const {
  sequelize,
  User,
  StaffProfile,
  AccessRole,
  AccessStaffInvite,
} = require('../models');
const AppError = require('../utils/AppError');
const { AUTH_CONFIG } = require('../features/auth/auth.constants');
const { invalidateUserAccessCache } = require('./authorization.service');
const { persistAdminAuditLog } = require('../features/admin/helpers/adminAudit.helper');

const BCRYPT_COST = AUTH_CONFIG.bcryptCostPassword || 12;

async function hashInviteToken(token) {
  return bcrypt.hash(`${token}`, 10);
}

async function verifyInviteToken(token, hash) {
  return bcrypt.compare(`${token}`, hash);
}

async function previewInvite(token) {
  const raw = `${token || ''}`.trim();
  if (!raw) throw new AppError('Token de convite inválido.', 400, null, true);

  const invites = await AccessStaffInvite.findAll({
    where: { accepted_at: null, expires_at: { [Op.gt]: new Date() } },
    order: [['created_at', 'DESC']],
    limit: 50,
  });

  let match = null;
  for (const inv of invites) {
    if (await verifyInviteToken(raw, inv.token_hash)) {
      match = inv;
      break;
    }
  }
  if (!match) throw new AppError('Convite inválido ou expirado.', 404, null, true);

  return {
    email: match.email,
    expiresAt: match.expires_at,
    departmentId: match.department_id,
    jobTitleId: match.job_title_id,
    roleIds: match.role_ids || [],
  };
}

async function acceptStaffInvite({ token, password, nome }, httpCtx = {}) {
  const raw = `${token || ''}`.trim();
  const pwd = `${password || ''}`;
  if (!raw || pwd.length < 8) {
    throw new AppError('Informe token válido e senha com pelo menos 8 caracteres.', 400, null, true);
  }

  const preview = await previewInvite(raw);
  const invites = await AccessStaffInvite.findAll({
    where: { email: preview.email, accepted_at: null },
    order: [['created_at', 'DESC']],
  });

  let invite = null;
  for (const inv of invites) {
    if (await verifyInviteToken(raw, inv.token_hash)) {
      invite = inv;
      break;
    }
  }
  if (!invite) throw new AppError('Convite inválido ou expirado.', 404, null, true);

  const hash = await bcrypt.hash(pwd, BCRYPT_COST);

  await sequelize.transaction(async (t) => {
    const user = await User.findByPk(invite.user_id, { transaction: t });
    if (!user) throw new AppError('Utilizador do convite não encontrado.', 404, null, true);

    await user.update(
      {
        password_hash: hash,
        email_verified_at: new Date(),
        is_active: true,
      },
      { transaction: t }
    );

    const profile = await StaffProfile.findOne({ where: { user_id: user.id }, transaction: t });
    if (profile) {
      await profile.update(
        {
          staff_status: 'ativo',
          first_login_at: new Date(),
          display_name: nome ? `${nome}`.trim() : profile.display_name,
        },
        { transaction: t }
      );
    }

    if (Array.isArray(invite.role_ids) && invite.role_ids.length) {
      const roles = await AccessRole.findAll({
        where: { id: { [Op.in]: invite.role_ids } },
        transaction: t,
      });
      await user.setAccess_roles(roles, { transaction: t });
    }

    await invite.update({ accepted_at: new Date() }, { transaction: t });

    await persistAdminAuditLog(
      {
        admin_id: user.id,
        action: 'ACCESS_STAFF_INVITE_ACCEPTED',
        target_entity: 'User',
        target_id: user.id,
        new_value: { email: user.email, staff_status: 'ativo' },
        httpCtx,
        metadata: { invite_id: invite.id },
      },
      { transaction: t }
    );
  });

  invalidateUserAccessCache(invite.user_id);
  return { ok: true, userId: invite.user_id, email: preview.email };
}

module.exports = {
  hashInviteToken,
  verifyInviteToken,
  previewInvite,
  acceptStaffInvite,
};
