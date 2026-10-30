'use strict';

/**
 * Fachada do serviço de autenticação.
 *
 * Dividido por responsabilidade para manutenção/escala — controllers, jobs e
 * outros módulos continuam importando `auth.service` sem mudanças.
 *
 *   - auth.tokens.service.js             → emissão/revogação de tokens, device, sanitize, RBAC
 *   - auth.email-verification.service.js → verificação de e-mail (OTP por link)
 *   - auth.password.service.js           → forgot/reset/admin-reset (OTP)
 *   - auth.accounts.service.js           → register + conversão de lead
 *   - auth.session.service.js            → login/refresh/logout/me + convite staff
 *   - identity.helper.js                 → desafio de identidade
 */
const tokens = require('./auth.tokens.service');
const emailVerification = require('./auth.email-verification.service');
const password = require('./auth.password.service');
const accounts = require('./auth.accounts.service');
const session = require('./auth.session.service');
const { generateIdentityChallenge } = require('./identity.helper');

module.exports = {
  // sessão
  register: accounts.register,
  login: session.login,
  refreshToken: session.refreshToken,
  logout: session.logout,
  getMe: session.getMe,
  patchMeProfile: session.patchMeProfile,
  previewStaffInvite: session.previewStaffInvite,
  acceptStaffInvite: session.acceptStaffInvite,
  // senha
  forgotPassword: password.forgotPassword,
  resetPassword: password.resetPassword,
  adminTriggerPasswordReset: password.adminTriggerPasswordReset,
  // verificação de e-mail
  verifyEmailFromToken: emailVerification.verifyEmailFromToken,
  resendVerificationEmail: emailVerification.resendVerificationEmail,
  syncEmailPendingReviewFlags: emailVerification.syncEmailPendingReviewFlags,
  enqueueEmailVerification: emailVerification.enqueueEmailVerification,
  // contas
  convertLeadToClient: accounts.convertLeadToClient,
  // identidade
  generateIdentityChallenge,
  // utilitários internos exportados para uso por outros módulos de auth/recovery/admin
  issueTokenPairForUser: tokens.issueTokenPairForUser,
  sanitizeUserRecord: tokens.sanitizeUserRecord,
  recordWebLoginDevice: tokens.recordWebLoginDevice,
  revokeAllRefreshTokensForUser: tokens.revokeAllRefreshTokensForUser,
};
