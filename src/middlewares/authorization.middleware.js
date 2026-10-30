'use strict';

const { StaffProfile } = require('../models');
const AppError = require('../utils/AppError');
const { STAFF_ROLES, USER_ROLES, nivelDe, requiresStepUp, requiresMotivo } = require('../rbac/rbac.constants');
const { pode, loadUserAccessContext, isStaffStatusActive } = require('../rbac/authorization.service');
const { requireRecentStepVerification } = require('./stepUp.middleware');

const BLOCKED_STAFF_STATUSES = new Set(['suspenso', 'desativado', 'bloqueado', 'expirado']);

/**
 * Exige conta interna (GESTORA|ATENDENTE) com staff_status permitido.
 * Legacy: GESTORA sem staff_profile continua válida.
 */
async function requireStaffAccess(req, _res, next) {
  try {
    const user = req.user;
    if (!user?.id) {
      throw new AppError('Sessão inválida.', 401, null, true);
    }

    const role = `${user.role || ''}`;
    if (!STAFF_ROLES.has(role)) {
      throw new AppError(
        'Recurso exclusivo para contas internas (GESTORA ou ATENDENTE).',
        403,
        { codigo: 'FORBIDDEN_NOT_STAFF' },
        true
      );
    }

    const profile = await StaffProfile.findOne({
      where: { user_id: user.id },
      paranoid: true,
      attributes: ['id', 'staff_status', 'must_change_password'],
    });

    if (!profile) {
      if (role === 'GESTORA') return next();
      throw new AppError(
        'Perfil interno não configurado. Contacte a gestão.',
        403,
        { codigo: 'FORBIDDEN_NO_STAFF_PROFILE' },
        true
      );
    }

    if (profile.must_change_password) {
      throw new AppError(
        'É necessário redefinir a senha antes de continuar.',
        403,
        { codigo: 'PASSWORD_CHANGE_REQUIRED' },
        true
      );
    }

    const status = `${profile.staff_status || ''}`;
    if (BLOCKED_STAFF_STATUSES.has(status)) {
      throw new AppError(
        `Acesso bloqueado — status da conta: ${status}.`,
        403,
        { codigo: 'FORBIDDEN_STAFF_STATUS', status },
        true
      );
    }

    if (!isStaffStatusActive(profile, user)) {
      throw new AppError('Conta interna inactiva.', 403, { codigo: 'FORBIDDEN_STAFF_INACTIVE' }, true);
    }

    req.staffProfile = profile;
    return next();
  } catch (err) {
    return next(err instanceof AppError ? err : new AppError('Acesso negado.', 403, null, true));
  }
}

function requirePermission(chave) {
  const permissionKey = `${chave || ''}`.trim();
  return async (req, _res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) throw new AppError('Sessão inválida.', 401, null, true);

      const allowed = await pode(userId, permissionKey, {
        allowPendingReadOnly: req.method === 'GET' || req.method === 'HEAD',
      });
      if (!allowed) {
        throw new AppError(
          'Permissão insuficiente para esta acção.',
          403,
          { codigo: 'FORBIDDEN_PERMISSION', chave: permissionKey },
          true
        );
      }
      return next();
    } catch (err) {
      return next(err instanceof AppError ? err : new AppError('Acesso negado.', 403, null, true));
    }
  };
}

function requireAnyPermission(...chaves) {
  const keys = (Array.isArray(chaves[0]) ? chaves[0] : chaves)
    .map((k) => `${k || ''}`.trim())
    .filter(Boolean);
  return async (req, _res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) throw new AppError('Sessão inválida.', 401, null, true);

      for (const chave of keys) {
        const ok = await pode(userId, chave, {
          allowPendingReadOnly: req.method === 'GET' || req.method === 'HEAD',
        });
        if (ok) return next();
      }

      throw new AppError(
        'Permissão insuficiente para esta acção.',
        403,
        { codigo: 'FORBIDDEN_PERMISSION', chaves: keys },
        true
      );
    } catch (err) {
      return next(err instanceof AppError ? err : new AppError('Acesso negado.', 403, null, true));
    }
  };
}

function requirePermissionWithStepUp(chave) {
  const permissionKey = `${chave || ''}`.trim();
  const chain = [requirePermission(permissionKey)];
  if (requiresMotivo(permissionKey)) {
    chain.push(requireMotivoBody(permissionKey));
  }
  if (requiresStepUp(permissionKey)) {
    chain.push(requireRecentStepVerification);
  }
  return (req, res, next) => {
    let i = 0;
    const run = (err) => {
      if (err) return next(err);
      if (i >= chain.length) return next();
      const mw = chain[i++];
      mw(req, res, run);
    };
    run();
  };
}

/** Exige `motivo` no body para acções alto/crítico (spec §8). */
function requireMotivoBody(chave) {
  const permissionKey = `${chave || ''}`.trim();
  return (req, _res, next) => {
    if (!requiresMotivo(permissionKey)) return next();
    const motivo = `${req.body?.motivo ?? req.body?.reason ?? ''}`.trim();
    if (!motivo) {
      return next(
        new AppError(
          'Motivo obrigatório para esta acção sensível.',
          400,
          { codigo: 'MOTIVO_REQUIRED', chave: permissionKey },
          true
        )
      );
    }
    req.sensitiveMotivo = motivo;
    return next();
  };
}

/**
 * Guard genérico por papel de PRODUTO (`req.user.role`): CLIENTE | TAROLOGA | GESTORA…
 *
 * Substitui os middlewares hard-coded `clienteRole`/`tarologaRole`/`gestoraRole`
 * (cada um um arquivo com `if role === 'X'`). Agora é data-driven e mora no módulo
 * de autorização (RBAC): adicionar um papel não cria arquivo novo.
 *
 * Nota: papéis de produto (cliente/taróloga/gestão) são distintos das PERMISSÕES de
 * staff (`requirePermission`). Este guard cobre o eixo de papel; o RBAC de permissão
 * continua para o back-office.
 *
 * @param {...(string|string[])} roles
 */
function requireUserRole(...roles) {
  const allowed = new Set(
    (Array.isArray(roles[0]) ? roles[0] : roles)
      .map((r) => `${r || ''}`.trim().toUpperCase())
      .filter(Boolean)
  );
  return (req, _res, next) => {
    if (!req.user?.id) {
      return next(new AppError('Sessão inválida.', 401, null, true));
    }
    const role = `${req.user.role || ''}`.trim().toUpperCase();
    if (!allowed.has(role)) {
      return next(
        new AppError(
          `Recurso restrito ao(s) perfil(is): ${[...allowed].join(', ')}.`,
          403,
          { codigo: 'FORBIDDEN_ROLE', requerido: [...allowed], atual: role || null },
          true
        )
      );
    }
    return next();
  };
}

/** Anexa contexto RBAC ao request (útil em /access/me). */
async function attachAccessContext(req, _res, next) {
  try {
    if (req.user?.id) {
      req.accessContext = await loadUserAccessContext(req.user.id);
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  requireStaffAccess,
  requirePermission,
  requireAnyPermission,
  requirePermissionWithStepUp,
  requireMotivoBody,
  requireUserRole,
  USER_ROLES,
  attachAccessContext,
};
