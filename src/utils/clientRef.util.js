'use strict';

/**
 * Fonte única de verdade para resolver a referência de cliente em todo o sistema,
 * abstraindo a diferença entre contas regulares (users/clients) e contas
 * temporárias (temporary_users/temporary_clients).
 *
 * Se a lógica de mapeamento mudar (ex.: nome da coluna, terceira origem de conta),
 * basta alterar ESTE arquivo — nenhum serviço referencia os literais diretamente.
 *
 * Uso nos serviços:
 *
 *   // Quando precisa carregar o perfil do banco:
 *   const { row, column } = await resolveClientRow(user, { include: [...] });
 *   await Session.create({ [column]: row.id, ... });
 *
 *   // Quando o perfil já veio pré-carregado pelo auth middleware:
 *   const { row, column } = resolveClientProfile(user);
 *
 *   // Quando só precisa do nome da coluna para um payload:
 *   await PaymentOrder.create({ [clientColumn(user)]: client.id, ... });
 *
 *   // Em where clauses de busca:
 *   await Queue.findOne({ where: { id, ...clientWhere(user, clientId) } });
 *
 *   // Para checar titularidade de um registro:
 *   if (!sessionBelongsToClient(session, user, clientId)) { ... }
 */

const { Client, TemporaryClient } = require('../models');

/** Coluna de FK usada por cada tipo de conta. Único ponto que conhece os literais. */
const REGULAR_COLUMN = 'client_id';
const TEMP_COLUMN = 'temp_client_id';

/**
 * Retorna o nome da coluna de FK de cliente para a conta autenticada.
 * @param {object} user Instância User ou TemporaryUser (com `_isTempAccount`)
 * @returns {'client_id'|'temp_client_id'}
 */
function clientColumn(user) {
  return user._isTempAccount ? TEMP_COLUMN : REGULAR_COLUMN;
}

/**
 * Carrega o perfil de cliente do banco e devolve { row, column }.
 *
 * @param {object} user  Instância User ou TemporaryUser (com `_isTempAccount`)
 * @param {object} [opts] Opções extras para o findOne (include, attributes, etc.)
 */
async function resolveClientRow(user, opts = {}) {
  if (user._isTempAccount) {
    const row = await TemporaryClient.findOne({
      where: { temp_user_id: user.id },
      paranoid: true,
      ...opts,
    });
    return { row, column: TEMP_COLUMN };
  }
  const row = await Client.findOne({
    where: { user_id: user.id },
    paranoid: true,
    ...opts,
  });
  return { row, column: REGULAR_COLUMN };
}

/**
 * Resolve o perfil de cliente já carregado via associação (sem hit no banco).
 * Assume que o auth middleware pré-carregou `client_profile`.
 */
function resolveClientProfile(user) {
  return { row: user.client_profile ?? null, column: clientColumn(user) };
}

/**
 * Monta o fragmento de where clause para filtrar por cliente.
 *
 *   Queue.findOne({ where: { id, ...clientWhere(user, clientId) } })
 */
function clientWhere(user, clientId) {
  return { [clientColumn(user)]: clientId };
}

/**
 * Verifica se um registro (sessão/pedido/etc.) pertence ao cliente autenticado,
 * independente do tipo de conta.
 */
function sessionBelongsToClient(row, user, clientId) {
  return `${row[clientColumn(user)]}` === `${clientId}`;
}

module.exports = {
  clientColumn,
  resolveClientRow,
  resolveClientProfile,
  clientWhere,
  sessionBelongsToClient,
};
