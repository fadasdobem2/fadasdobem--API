'use strict';

const jwt = require('jsonwebtoken');
const { User, Client, TemporaryUser, TemporaryClient } = require('../models');
const AppError = require('../utils/AppError');
const { jwtVerifyOptions } = require('../config/auth.config');
const { ACCESS_COOKIE } = require('../features/auth/auth.cookies.helper');

/**
 * Lê o access JWT exclusivamente do cookie httpOnly `__Secure-fdb_access`.
 *
 * Suporta dois tipos de conta:
 *   account_type = 'user' (padrão) → carrega de `users` + `clients`
 *   account_type = 'temp'          → carrega de `temporary_users` + `temporary_clients`
 *
 * Em ambos os casos injeta `req.user` (com `client_profile`) e `req.jwtClaims`.
 * Para contas temporárias, também seta `req.isTempAccount = true` e
 * marca `req.user._isTempAccount = true` para uso nos serviços via clientRef.util.
 */
module.exports = async function authMiddleware(req, res, next) {
  try {
    const raw = req.cookies && req.cookies[ACCESS_COOKIE];
    if (!raw) {
      throw new AppError('Sessão não encontrada. Faça login.', 401, null, true);
    }

    let payload;
    try {
      payload = jwt.verify(raw.trim(), process.env.JWT_SECRET, jwtVerifyOptions());
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError('Sessão expirada. Renove via /auth/refresh-token.', 401, null, true);
      }
      throw new AppError('Token inválido ou corrompido.', 401, null, true);
    }

    if (payload.token_use !== 'access') {
      throw new AppError('Tipo de token incorreto para esta rota.', 401, null, true);
    }

    const isTempAccount = payload.account_type === 'temp';

    let user;

    if (isTempAccount) {
      user = await TemporaryUser.findByPk(payload.sub, {
        include: [{ model: TemporaryClient, as: 'client_profile', required: false }],
      });

      if (!user) {
        throw new AppError('Conta temporária não encontrada ou removida.', 401, null, true);
      }
      if (!user.is_active) {
        throw new AppError('Conta desativada. Contate o suporte.', 401, null, true);
      }
      if (user.blocked_at) {
        throw new AppError('Conta bloqueada. Contate o suporte.', 401, null, true);
      }

      // Marca a instância para que os serviços possam distinguir sem nova query
      user._isTempAccount = true;
    } else {
      user = await User.findByPk(payload.sub, {
        include: [{ model: Client, as: 'client_profile', required: false }],
      });

      if (!user) {
        throw new AppError('Conta não encontrada ou removida.', 401, null, true);
      }
      if (!user.is_active) {
        throw new AppError('Conta desativada. Contate o suporte.', 401, null, true);
      }
      if (user.blocked_at) {
        throw new AppError('Conta bloqueada. Contate o suporte.', 401, null, true);
      }

      user._isTempAccount = false;
    }

    req.jwtClaims = payload;
    req.user = user;
    req.isTempAccount = isTempAccount;
    return next();
  } catch (err) {
    return next(err instanceof AppError ? err : new AppError('Não autorizado.', 401, null, true));
  }
};
