'use strict';

/**
 * Recurso `payouts` do modo real (R24, features/domain/real-features.ts da B): `FADAS_ENVIRONMENT=test` liga,
 * `production` ou ausente desliga. Desligado, TODA rota `/payouts/*` responde 404 NOT_FOUND antes do método, da
 * origem e da sessão, sem abrir conexão (como `payoutsOff` em real-payouts-http.server.ts).
 */

const { enviarErro } = require('./http');

function payoutsLigado(env = process.env) {
  return `${env.FADAS_ENVIRONMENT || ''}`.trim().toLowerCase() === 'test';
}

/** Middleware para montar em `/payouts`. */
function payoutsOff(req, res, next) {
  return payoutsLigado() ? next() : enviarErro(res, 'NOT_FOUND');
}

module.exports = { payoutsLigado, payoutsOff };
