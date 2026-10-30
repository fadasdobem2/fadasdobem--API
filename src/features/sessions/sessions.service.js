'use strict';

/**
 * Barrel do serviço de sessões. A implementação foi decomposta por
 * responsabilidade, preservando exatamente a superfície pública consumida pelos
 * controllers/jobs/sockets:
 *
 *  - sessions.shared.js     constantes + helpers puros (mídia, review, UID, money)
 *  - sessions.economics.js  ledger + split de comissão + fecho + piso mínimo
 *  - sessions.lifecycle.js  criação + trilho de consumo + transição telecom
 *  - sessions.billing.js    cronômetro de cobrança (WARNING / hard cut)
 *  - sessions.rtc.js        emissão de token Agora RTC
 *  - sessions.webhooks.js   webhooks Agora NCS + Intelbras (legado)
 *  - sessions.reviews.js    avaliação da cliente + mensagem ritualística
 */
const {
  mediaPolicyForModality,
  SESSION_MEDIA_POLICY,
  clampExpires,
} = require('./sessions.shared');
const { applyMinimumFloorReimbursement } = require('./sessions.economics');
const { createSession } = require('./sessions.lifecycle');
const { billingTickSweepAsync, runBillingTickSweep } = require('./sessions.billing');
const { getRtcTokenForAuthenticatedUser } = require('./sessions.rtc');
const {
  summarizeNcsBodyForLog,
  processAgoraNcsWebhookAsync,
  processIntelbrasTelephonyWebhookAsync,
} = require('./sessions.webhooks');
const { submitSessionReview, patchPostSessionRitual } = require('./sessions.reviews');

module.exports = {
  clampExpires,
  summarizeNcsBodyForLog,
  createSession,
  getRtcTokenForAuthenticatedUser,
  processAgoraNcsWebhookAsync,
  billingTickSweepAsync,
  /** versão não empacotada do sweep (workers / testes) */
  runBillingTickSweep,
  /**
   * Mantido para sessões legadas com `telecom_provider = 'INTELBRAS'`.
   * **Não use em fluxos novos** — ver `src/features/telecom/DESATIVADO.md`.
   */
  processIntelbrasTelephonyWebhookAsync,
  applyMinimumFloorReimbursement,
  submitSessionReview,
  patchPostSessionRitual,
  /** Política de mídia por modalidade (VOZ: só áudio; VIDEO: vídeo + áudio, vídeo forçado on). */
  mediaPolicyForModality,
  SESSION_MEDIA_POLICY,
};
