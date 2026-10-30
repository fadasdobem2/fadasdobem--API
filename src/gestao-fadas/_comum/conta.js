'use strict';

/**
 * A conta que ASSINA uma gravação (auditoria, `registrado_por`...). No modo `postgres` (banco novo) é o USUÁRIO da A
 * (`req.user.id`, tabela `users`); no modo `mysql` é a conta de `gf_auth_accounts` (`gfContaId`) ou, sem ela, o `id` da sessão.
 */

const { novosDadosNoPostgres } = require('../novo/modo');

function contaDaRequisicao(req, env = process.env) {
  const u = (req && req.user) || {};
  if (novosDadosNoPostgres(env)) return `${u.id ?? ''}`.trim();
  return String(u.gfContaId || u.id);
}

module.exports = { contaDaRequisicao };
