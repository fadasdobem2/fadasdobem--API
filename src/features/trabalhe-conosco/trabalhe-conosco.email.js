'use strict';

const AppError = require('../../utils/AppError');
const { normalizeEmail, assertEmailFormat } = require('../auth/auth.constants');
const { AUTH_MESSAGES } = require('../auth/auth.constants');
const { isDisposableEmailAddress } = require('../../config/disposableEmails.config');

function assertTrabalheConoscoEmail(rawEmail) {
  assertEmailFormat(rawEmail);
  const mail = normalizeEmail(rawEmail);
  if (isDisposableEmailAddress(mail)) {
    throw new AppError(AUTH_MESSAGES.EMAIL_DISPOSABLE, 400, null, true);
  }
  return mail;
}

module.exports = {
  assertTrabalheConoscoEmail,
};
