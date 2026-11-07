'use strict';

/** A ampliação do histórico (R25): liberação da supervisora (fatia de clientes.model.js). */

const { validateHistoryAccessReason } = require('./helpers/historico');
const { permissionsFor } = require('./helpers/perfis');

/** A ação da linha de gf_auditoria que é a liberação da supervisora ao histórico completo de uma cliente. */
const CLIENT_HISTORY_GRANT_ACTION = 'clients.history.expand';
const CLIENT_HISTORY_GRANT_ENTITY = 'cliente';

/**
 * O registro de uma ampliação, ou por que não há: só a supervisora amplia (canExpandRealClientHistory) e o motivo é
 * aparado de 1 a 500 caracteres por validateHistoryAccessReason da v608.
 * `context` = { clientId, actor: { accountId, role }, sessionId }.
 */
function planRealClientHistoryGrant(context, reason) {
  if (!permissionsFor(context.actor.role).canExpandRealClientHistory) return { denied: 'role' };
  let trimmed;
  try {
    trimmed = validateHistoryAccessReason(reason);
  } catch {
    return { denied: 'input' };
  }
  return {
    fact: {
      actorUserId: context.actor.accountId, actorRole: context.actor.role, action: CLIENT_HISTORY_GRANT_ACTION, entity: CLIENT_HISTORY_GRANT_ENTITY,
      entityId: context.clientId, after: { sessionId: context.sessionId }, reason: trimmed,
    },
  };
}

/**
 * Se uma linha guardada é liberação para esta leitura: ampliação da supervisora para a mesma cliente, pela mesma conta,
 * função e sessão. Não tem prazo próprio; o fim da sessão a encerra (R25). `entry` = { action, entity, entityId,
 * actorUserId, actorRole, after, reason }.
 */
function isRealClientHistoryGrantFor(entry, context) {
  const after = entry.after;
  return permissionsFor(context.actor.role).canExpandRealClientHistory
    && entry.action === CLIENT_HISTORY_GRANT_ACTION && entry.entity === CLIENT_HISTORY_GRANT_ENTITY && entry.entityId === context.clientId
    && entry.actorUserId === context.actor.accountId && entry.actorRole === context.actor.role
    && typeof after === 'object' && after !== null && after.sessionId === context.sessionId;
}

/** Se a linha guardada sob uma chave de operação é esta mesma ampliação repetida (mesma liberação) ou outra (409). */
function sameRealClientHistoryGrant(entry, fact) {
  const context = { clientId: fact.entityId, actor: { accountId: fact.actorUserId, role: fact.actorRole }, sessionId: fact.after.sessionId };
  return isRealClientHistoryGrantFor(entry, context) && entry.reason === fact.reason;
}

module.exports = {
  CLIENT_HISTORY_GRANT_ACTION,
  isRealClientHistoryGrantFor,
  planRealClientHistoryGrant,
  sameRealClientHistoryGrant,
};
