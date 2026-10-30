'use strict';

/**
 * Fachada do serviço de recuperação/merge de contas.
 *
 * Dividido por responsabilidade para manutenção — o controller continua
 * importando `admin.recovery.service` sem mudanças.
 *
 *   - admin.recovery.shared.js            → constantes/estágios/helpers
 *   - admin.recovery.queries.service.js   → listagem, detalhe e candidatos (matching)
 *   - admin.recovery.messages.service.js  → mensagens admin↔usuário
 *   - admin.recovery.sync.service.js      → sincronização/merge completo
 *   - admin.recovery.workflow.service.js  → atribuição, estágio, conta original, notas
 */
const queries = require('./admin.recovery.queries.service');
const messages = require('./admin.recovery.messages.service');
const sync = require('./admin.recovery.sync.service');
const workflow = require('./admin.recovery.workflow.service');

module.exports = {
  listRecoveryRequests: queries.listRecoveryRequests,
  getRecoveryRequestDetail: queries.getRecoveryRequestDetail,
  findOriginalUserCandidates: queries.findOriginalUserCandidates,
  assignAdmin: workflow.assignAdmin,
  updateStage: workflow.updateStage,
  setOriginalUser: workflow.setOriginalUser,
  updateNotes: workflow.updateNotes,
  sendAdminMessage: messages.sendAdminMessage,
  markMessagesRead: messages.markMessagesRead,
  syncAccounts: sync.syncAccounts,
};
