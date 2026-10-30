'use strict';

/**
 * Flag R24 das GRAVAÇÕES de repasse. Na B (`real-features.ts`), a etapa 2 fica ligada no ambiente `test` e desligada em
 * `production` (`payoutsOff()` responde 404 antes de abrir conexão). Aqui a gravação só existe quando as DUAS coisas valem:
 *   - `GESTAO_FADAS_ESCRITA_ENABLED=true` (chave da conexão de escrita, models/legado/escrita.js); e
 *   - `FADAS_ENVIRONMENT=test` (o mesmo nome e valores da B: `test` liga, `production` ou ausente desliga).
 * Ausente ou desconhecido conta como produção: nunca se liga por engano.
 */

const AppError = require('../../../../utils/AppError');
const { escritaHabilitada } = require('../../../novo/escritor');

function repasseEscritaLigada(env = process.env) {
  return env.GESTAO_FADAS_ESCRITA_ENABLED === 'true' && `${env.FADAS_ENVIRONMENT || ''}`.trim().toLowerCase() === 'test';
}

/** Middleware: desligada, a rota responde 404 como na demonstração da B, antes de tocar em banco ou sessão de escrita. */
function exigirEscritaLigada(req, _res, next) {
  if (repasseEscritaLigada() && escritaHabilitada()) return next();
  return next(new AppError('Não encontrado.', 404, { codigo: 'NOT_FOUND' }, true));
}

module.exports = { repasseEscritaLigada, exigirEscritaLigada };
