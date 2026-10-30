'use strict';

/**
 * MODO POSTGRES (padrão, `GF_NOVOS_DADOS`): o ator é o usuário da A (`req.user.id`), FK real para `users(id)`; o texto abaixo
 * vale só para o modo `mysql`.
 *
 * Quem assina a gravação. Na B o ator é a conta de `gf_auth_accounts` (id e papel da sessão), e `registrado_por`,
 * `lancado_por`, `confirmado_por` e `ator_conta_id` têm FOREIGN KEY para ela. A API A tem autenticação própria (ids do
 * PostgreSQL) e NÃO tem conta em `gf_auth_accounts`, que também não pode ser criada daqui (guarda credenciais).
 *
 * Por isso a conta que assina vem de FORA e precisa EXISTIR em `gf_auth_accounts`, nesta ordem:
 *   1. `req.user.gfContaId` (se um dia o login da A guardar o vínculo);
 *   2. `GESTAO_FADAS_ESCRITA_CONTA_ID` (conta de serviço combinada com o Lucas/Nice).
 * Sem nenhuma, a gravação é recusada com 503 (nunca se inventa a conta). DECISÃO PENDENTE: com a conta de serviço, a
 * auditoria diz "a API gravou", não "qual pessoa"; o `userId` da A vai em `motivo`/log pela camada gate.
 */

const AppError = require('../../../../utils/AppError');
const { resolverPerfil } = require('../../../_comum/politica-acesso');
const { novosDadosNoPostgres } = require('../../../novo/modo');

function atorDe(req, env = process.env) {
  const perfil = resolverPerfil(req);
  // Banco novo (padrão): quem assina é o usuário da A, sem conta de serviço. O modo mysql mantém a regra abaixo.
  const conta = novosDadosNoPostgres(env)
    ? `${(req.user && req.user.id) || ''}`.trim()
    : `${(req.user && req.user.gfContaId) || env.GESTAO_FADAS_ESCRITA_CONTA_ID || ''}`.trim();
  if (!perfil || !conta || conta.length > 64) {
    throw new AppError('Gravação indisponível: conta de auditoria não configurada.', 503, { codigo: 'ESCRITA_CONTA_AUSENTE' });
  }
  return { accountId: conta, role: perfil };
}

module.exports = { atorDe };
