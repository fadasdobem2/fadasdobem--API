'use strict';

/**
 * Monta o contexto de acesso que as features de `gestao-fadas` esperam (`req.user`, `req.accessContext`), a partir do
 * perfil da B que o provedor de sessão devolveu. É o caminho INVERSO de `MAPEAMENTO_PERFIL`: escolhe, para cada perfil,
 * o papel que `resolverPerfil` (politica-acesso.js) traduz de volta para ele; a regra de acesso continua só lá.
 *
 * Nada do request (query, headers, corpo) escolhe perfil ou conta: só a sessão validada.
 */

const AppError = require('../../utils/AppError');
const { MAPEAMENTO_PERFIL, resolverPerfil } = require('../_comum/politica-acesso');

/** Perfil da B -> `roleIds` RBAC; a tarologa não tem papel RBAC e vale pelo papel de produto (TAROLOGA). */
const PAPEL_RBAC_DO_PERFIL = Object.freeze({
  administradora: 'admin', assistente: 'assistente', supervisora: 'supervisora', atendente: 'atendente', tarologa: null,
});
const PAPEL_PRODUTO_DO_PERFIL = Object.freeze({ administradora: 'GESTORA', assistente: 'GESTORA', supervisora: 'GESTORA', atendente: 'ATENDENTE', tarologa: 'TAROLOGA' });

/** Preenche `req` e confere a ida e volta (perfil -> contexto -> `resolverPerfil`); divergência é erro, nunca perfil aproximado. */
function aplicarContexto(req, { identity, sessionId }) {
  const perfil = identity.role;
  const papel = PAPEL_RBAC_DO_PERFIL[perfil];
  req.user = { id: String(identity.userId), role: PAPEL_PRODUTO_DO_PERFIL[perfil], nome: identity.displayName || null, sessionId, ...(identity.tarotId ? { tarotId: String(identity.tarotId) } : {}), gfContaId: identity.gfContaId !== undefined ? identity.gfContaId : String(identity.userId) };
  req.jwtClaims = { sid: sessionId };
  req.accessContext = { roleIds: papel ? [papel] : [], origem: 'gate' };
  req.sessionId = sessionId;
  req.perfilGate = perfil;
  if (resolverPerfil(req, MAPEAMENTO_PERFIL) !== perfil) {
    throw new AppError('Perfil da sessão não corresponde ao mapeamento de acesso.', 500, { codigo: 'GATE_PERFIL_DIVERGENTE' }, false);
  }
}

module.exports = { aplicarContexto };
