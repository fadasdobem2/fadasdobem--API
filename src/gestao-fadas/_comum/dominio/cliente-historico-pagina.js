'use strict';

/**
 * Tamanho da página do histórico da ficha (v706). Porta de `pageSize` de features/clientes/client-profile-history.tsx:
 * a v706 corta TODA página em 10, qualquer que seja o alcance. Substitui a regra da v608 (alcance limitado cabia numa
 * página só, de 10 ou 20; o histórico completo tinha páginas de 15). O alcance em si (atendente 10, supervisora 20,
 * demais completo) não mudou e continua em `visibleClientHistory`.
 */

const CLIENT_HISTORY_PAGE_SIZE = 10;

/** `scope` só é lido pelo chamador para o rótulo "Últimas N"; a página é sempre a mesma. */
function realClientHistoryPageSize(_scope) {
  return CLIENT_HISTORY_PAGE_SIZE;
}

module.exports = { CLIENT_HISTORY_PAGE_SIZE, realClientHistoryPageSize };
