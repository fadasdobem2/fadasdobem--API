'use strict';

/**
 * Autenticação do webhook da Umbler (fail closed). A Umbler dispara o webhook de uma ação do robô e deixa
 * mandar um cabeçalho próprio: configure `X-Umbler-Webhook-Token` com o mesmo valor de UMBLER_WEBHOOK_TOKEN.
 * Comparação em tempo constante. Sem o token configurado a rota responde 503.
 * UMBLER_WEBHOOK_AUTH_DISABLED=true só vale fora de produção.
 */

const AppError = require('../../utils/AppError');
const guard = require('../../features/chatwoot/webhook.guard');

function verifyUmblerWebhook(req, res, next) {
  try {
    if (guard.bypassPermitido('UMBLER_WEBHOOK_AUTH_DISABLED')) return next();

    const token = `${process.env.UMBLER_WEBHOOK_TOKEN || ''}`.trim();
    if (!token) {
      console.error('[umbler:webhook:auth] sem UMBLER_WEBHOOK_TOKEN: webhook bloqueado.');
      return next(new AppError('Webhook Umbler não configurado.', 503, null, true));
    }
    const enviado = `${req.get('x-umbler-webhook-token') || ''}`.trim();
    if (enviado && guard.safeEqual(token, enviado)) return next();
    console.warn('[umbler:webhook:auth] recusado (credencial ausente ou invalida)');
    return next(new AppError('Webhook não autorizado.', 401, null, true));
  } catch (err) {
    return next(err);
  }
}

module.exports = { verifyUmblerWebhook };
