'use strict';

const crypto = require('crypto');

function generatePkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

function generateState() {
  return crypto.randomBytes(24).toString('base64url');
}

module.exports = {
  generatePkcePair,
  generateState,
};
