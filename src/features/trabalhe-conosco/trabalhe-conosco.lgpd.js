'use strict';

const AppError = require('../../utils/AppError');
const { LGPD_CONSENT_VERSION } = require('./trabalhe-conosco.constants');

function isLgpdConsentGiven(body = {}) {
  const raw =
    body.lgpd_consent ??
    body.lgpdConsent ??
    body.consentimento_lgpd ??
    body.consentimentoLgpd ??
    body.consent_lgpd;
  if (raw === true || raw === 1 || raw === '1' || `${raw}`.toLowerCase() === 'true') return true;
  return false;
}

function assertLgpdConsent(body = {}) {
  if (!isLgpdConsentGiven(body)) {
    throw new AppError(
      'Aceite a Política de Privacidade para enviar sua candidatura.',
      400,
      null,
      true
    );
  }
}

function buildLgpdMeta(body = {}, httpCtx = {}) {
  const version =
    `${body.lgpd_version ?? body.lgpdVersion ?? LGPD_CONSENT_VERSION}`.trim() ||
    LGPD_CONSENT_VERSION;
  return {
    lgpd: {
      version,
      accepted_at: new Date().toISOString(),
      ip: httpCtx.ip || null,
      user_agent: httpCtx.user_agent || null,
    },
  };
}

module.exports = {
  isLgpdConsentGiven,
  assertLgpdConsent,
  buildLgpdMeta,
};
