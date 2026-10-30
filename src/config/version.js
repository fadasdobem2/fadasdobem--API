/**
 * Versão SemVer pública da API (health, ping, documentação).
 * Sobrescreva em deploy com APP_VERSION=1.2.3 se necessário.
 */
const API_VERSION_SEMVER = (process.env.APP_VERSION || '1.0.0').trim();

module.exports = {
  API_VERSION_SEMVER,
};
