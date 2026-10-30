'use strict';

const {
  AccessRole,
  AccessPermission,
  AccessDepartment,
  AccessUserException,
  StaffProfile,
  User,
} = require('../models');
const AppError = require('../utils/AppError');
const {
  ROOT_ROLE_ID,
  PROTECTED_SYSTEM_ROLES,
  isDepartmentEligible,
  nivelDe,
} = require('./rbac.constants');
const {
  startRbacCacheBus,
  publishInvalidateUser,
  publishInvalidateAll,
} = require('./rbac.cache-bus');

const CACHE_TTL_MS = 30_000;
/** @type {Map<string, { expiresAt: number, ctx: object }>} */
const contextCache = new Map();
/** @type {{ map: Map<string, boolean>, expiresAt: number } | null} */
let activePermissionCache = null;
const PERM_CACHE_TTL_MS = 60_000;

async function isPermissionActive(chave) {
  const key = `${chave || ''}`.trim();
  if (!key) return false;

  const now = Date.now();
  if (!activePermissionCache || now > activePermissionCache.expiresAt) {
    const rows = await AccessPermission.findAll({
      where: { ativo: true },
      attributes: ['chave'],
      paranoid: true,
    });
    activePermissionCache = {
      map: new Map(rows.map((r) => [r.chave, true])),
      expiresAt: now + PERM_CACHE_TTL_MS,
    };
  }
  return activePermissionCache.map.has(key);
}

function invalidatePermissionCatalogCache() {
  activePermissionCache = null;
}

/** Limpeza LOCAL (sem publicar) — usada por este processo e pelo subscriber do bus. */
function clearLocalUser(userId) {
  if (userId) contextCache.delete(cacheKey(userId));
}
function clearLocalAll() {
  contextCache.clear();
  invalidatePermissionCatalogCache();
}

function cacheKey(userId) {
  return `${userId || ''}`.trim();
}

function getCachedContext(userId) {
  const key = cacheKey(userId);
  const hit = contextCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    contextCache.delete(key);
    return null;
  }
  return hit.ctx;
}

function setCachedContext(userId, ctx) {
  contextCache.set(cacheKey(userId), {
    ctx,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/** Invalida ESTA instância e propaga a limpeza às demais via Redis pub/sub. */
function invalidateUserAccessCache(userId) {
  clearLocalUser(userId);
  publishInvalidateUser(userId);
}

function invalidateAllAccessCache() {
  clearLocalAll();
  publishInvalidateAll();
}

/** Liga o subscriber: mensagens de outras instâncias limpam só o cache local (sem re-publicar). */
startRbacCacheBus({
  onUser: (id) => clearLocalUser(id),
  onAll: () => clearLocalAll(),
});

function permissionsToMap(permissions = []) {
  const out = {};
  for (const p of permissions) {
    if (p?.chave && p.ativo !== false) out[p.chave] = 1;
  }
  return out;
}

function roleHasAllAccess(role) {
  if (!role) return false;
  if (role.all_access) return true;
  if (`${role.id}` === ROOT_ROLE_ID) return true;
  return false;
}

function mergePermMaps(...maps) {
  const out = {};
  for (const m of maps) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) {
      if (v) out[k] = 1;
    }
  }
  return out;
}

function exceptionsToMap(exceptions = []) {
  const out = {};
  for (const ex of exceptions) {
    const chave = ex?.permission?.chave;
    if (!chave) continue;
    out[chave] = { granted: !!ex.granted, motivo: ex.motivo || '', id: ex.id };
  }
  return out;
}

/**
 * @param {string} userId
 * @param {{ bypassCache?: boolean }} [opts]
 */
async function loadUserAccessContext(userId, opts = {}) {
  const uid = `${userId || ''}`.trim();
  if (!uid) throw new AppError('user_id inválido.', 400, null, true);

  if (!opts.bypassCache) {
    const cached = getCachedContext(uid);
    if (cached) return cached;
  }

  const user = await User.findByPk(uid, {
    paranoid: true,
    attributes: ['id', 'email', 'role', 'is_active', 'blocked_at', 'last_login_at'],
    include: [
      {
        model: StaffProfile,
        as: 'staff_profile',
        required: false,
        include: [
          {
            model: AccessDepartment,
            as: 'access_department',
            required: false,
            include: [
              {
                model: AccessPermission,
                as: 'permissions',
                required: false,
                where: { ativo: true },
              },
            ],
          },
        ],
      },
      {
        model: AccessRole,
        as: 'access_roles',
        required: false,
        where: { ativo: true },
        include: [
          {
            model: AccessPermission,
            as: 'permissions',
            required: false,
            where: { ativo: true },
          },
        ],
      },
      {
        model: AccessUserException,
        as: 'access_exceptions',
        required: false,
        include: [
          {
            model: AccessPermission,
            as: 'permission',
            required: true,
            where: { ativo: true },
          },
        ],
      },
    ],
  });

  if (!user) throw new AppError('Utilizador não encontrado.', 404, null, true);

  const roles = user.access_roles || [];
  const staffProfile = user.staff_profile || null;
  const department = staffProfile?.access_department || null;
  const exceptions = user.access_exceptions || [];

  const roleIds = roles.map((r) => r.id);
  const hasAllAccess = roles.some((r) => roleHasAllAccess(r));

  let rolePerms = {};
  if (hasAllAccess) {
    rolePerms = 'ALL';
  } else {
    const maps = roles.map((r) => permissionsToMap(r.permissions));
    rolePerms = mergePermMaps(...maps);
  }

  let departmentPerms = {};
  if (department?.permissions?.length) {
    const eligible = department.permissions.filter((p) => isDepartmentEligible(nivelDe(p.chave)));
    departmentPerms = permissionsToMap(eligible);
  }

  const roleCount = await AccessRole.count({ paranoid: true });
  const bootstrapAll =
    roleCount === 0 && `${user.role}` === 'GESTORA';

  const ctx = {
    user,
    staffProfile,
    roles,
    roleIds,
    department,
    exceptions,
    exceptionMap: exceptionsToMap(exceptions),
    rolePerms,
    departmentPerms,
    hasAllAccess: hasAllAccess || bootstrapAll,
    bootstrapAll,
    staffStatus: staffProfile?.staff_status || null,
    isStaffActive: isStaffStatusActive(staffProfile, user),
  };

  setCachedContext(uid, ctx);
  return ctx;
}

function isStaffStatusActive(staffProfile, user) {
  if (!staffProfile) {
    return `${user?.role}` === 'GESTORA';
  }
  const st = `${staffProfile.staff_status || ''}`;
  return st === 'ativo' || st === 'pendente';
}

function computeBasePermission(ctx, chave) {
  if (ctx.hasAllAccess || ctx.rolePerms === 'ALL') return true;
  if (ctx.rolePerms?.[chave]) return true;
  if (isDepartmentEligible(nivelDe(chave)) && ctx.departmentPerms?.[chave]) return true;
  return false;
}

/**
 * @param {string} userId
 * @param {string} chave
 * @param {{ allowPendingReadOnly?: boolean, requireActive?: boolean }} [opts]
 */
async function pode(userId, chave, opts = {}) {
  const key = `${chave || ''}`.trim();
  if (!key) return false;

  const ctx = await loadUserAccessContext(userId);

  if (opts.requireActive !== false && !ctx.isStaffActive) return false;
  if (
    ctx.staffProfile &&
    ctx.staffProfile.staff_status === 'pendente' &&
    opts.allowPendingReadOnly === false
  ) {
    return false;
  }

  if (!(await isPermissionActive(key))) return false;

  if (ctx.bootstrapAll || ctx.hasAllAccess) return true;

  const ex = ctx.exceptionMap[key];
  if (ex) return !!ex.granted;

  return computeBasePermission(ctx, key);
}

async function podeMany(userId, chaves = [], opts = {}) {
  const list = Array.isArray(chaves) ? chaves : [];
  const out = {};
  for (const chave of list) {
    const k = `${chave || ''}`.trim();
    if (!k) continue;
    out[k] = await pode(userId, k, opts);
  }
  return out;
}

async function userHasRootRole(userId) {
  const ctx = await loadUserAccessContext(userId);
  if (ctx.bootstrapAll) return true;
  return ctx.roleIds.includes(ROOT_ROLE_ID);
}

async function assertCanManageTarget(actorId, targetUserId) {
  const actor = `${actorId || ''}`.trim();
  const target = `${targetUserId || ''}`.trim();
  if (!actor || !target) {
    throw new AppError('Identificadores inválidos.', 400, null, true);
  }
  if (actor === target) return true;

  const targetCtx = await loadUserAccessContext(target);
  const targetIsRoot =
    targetCtx.roleIds.includes(ROOT_ROLE_ID) ||
    targetCtx.roles.some((r) => PROTECTED_SYSTEM_ROLES.has(r.id));

  if (!targetIsRoot) return true;

  const actorIsRoot = await userHasRootRole(actor);
  if (!actorIsRoot) {
    throw new AppError(
      'Conta Admin protegida — apenas outro Admin pode alterá-la.',
      403,
      { codigo: 'FORBIDDEN_PROTECTED_ADMIN' },
      true
    );
  }
  return true;
}

module.exports = {
  loadUserAccessContext,
  pode,
  podeMany,
  userHasRootRole,
  assertCanManageTarget,
  invalidateUserAccessCache,
  invalidateAllAccessCache,
  invalidatePermissionCatalogCache,
  isStaffStatusActive,
  roleHasAllAccess,
};
