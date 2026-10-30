'use strict';

const { Op } = require('sequelize');
const { User, AccessRole } = require('../models');
const AppError = require('../utils/AppError');
const { ROOT_ROLE_ID } = require('./rbac.constants');

/**
 * Conta utilizadores internos activos com papel admin.
 */
async function countActiveRootAdmins(excludeUserId = null) {
  const whereUser = {
    role: { [Op.in]: ['GESTORA', 'ATENDENTE'] },
    is_active: true,
  };

  const users = await User.findAll({
    where: whereUser,
    attributes: ['id'],
    include: [
      {
        model: AccessRole,
        as: 'access_roles',
        required: true,
        where: { id: ROOT_ROLE_ID, ativo: true },
        attributes: ['id'],
      },
      {
        association: 'staff_profile',
        required: true,
        where: {
          staff_status: { [Op.in]: ['ativo', 'pendente'] },
        },
        attributes: ['id'],
      },
    ],
  });

  const filtered = excludeUserId
    ? users.filter((u) => `${u.id}` !== `${excludeUserId}`)
    : users;
  return filtered.length;
}

/**
 * Impede remover o último admin activo do sistema (spec §4 — admin raiz protegido).
 */
async function assertAtLeastOneRootAdminRemains({ userId, nextRoleIds = null } = {}) {
  const uid = `${userId || ''}`.trim();
  if (!uid) return;

  const user = await User.findByPk(uid, {
    include: [{ model: AccessRole, as: 'access_roles', required: false }],
  });
  if (!user) return;

  const currentHasRoot = (user.access_roles || []).some((r) => r.id === ROOT_ROLE_ID);
  if (!currentHasRoot) return;

  const willKeepRoot =
    nextRoleIds == null
      ? true
      : (Array.isArray(nextRoleIds) ? nextRoleIds : []).includes(ROOT_ROLE_ID);

  if (willKeepRoot) return;

  const remaining = await countActiveRootAdmins(uid);
  if (remaining < 1) {
    throw new AppError(
      'Não é possível remover o último Admin activo do sistema.',
      409,
      { codigo: 'FORBIDDEN_LAST_ROOT_ADMIN' },
      true
    );
  }
}

module.exports = {
  countActiveRootAdmins,
  assertAtLeastOneRootAdminRemains,
};
