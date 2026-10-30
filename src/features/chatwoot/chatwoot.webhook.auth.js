'use strict';

/**
 * Autenticação do webhook do Chatwoot (fail closed).
 *
 * Esquema oficial (Chatwoot 4.x, "webhook signature"):
 *   X-Chatwoot-Signature: sha256=HMAC_SHA256(segredo, `${X-Chatwoot-Timestamp}.${corpo_bruto}`) em hex
 *   X-Chatwoot-Timestamp: segundos Unix
 *   X-Chatwoot-Delivery: id único da entrega (usado contra replay)
 * Alternativa para versões sem assinatura (ou proxy na frente): segredo compartilhado no header
 *   X-Chatwoot-Webhook-Token (comparação em tempo constante).
 *
 * Sem CHATWOOT_WEBHOOK_SECRET nem CHATWOOT_WEBHOOK_TOKEN a rota responde 503.
 * CHATWOOT_WEBHOOK_AUTH_DISABLED=true só vale fora de produção (teste/dev).
 */

const AppError = require('../../utils/AppError');
const { responderSucesso } = require('../../utils/response.util');
const guard = require('./webhook.guard');

const TOLERANCIA_PADRAO_S = 300;
const SHA256_HEX = /^sha256=([0-9a-f]{64})$/i;

function configuracao() {
  return {
    segredo: `${process.env.CHATWOOT_WEBHOOK_SECRET || ''}`.trim(),
    token: `${process.env.CHATWOOT_WEBHOOK_TOKEN || ''}`.trim(),
    tolerancia: guard.envInt('CHATWOOT_WEBHOOK_TOLERANCE_S', TOLERANCIA_PADRAO_S),
  };
}

function recusar(motivo) {
  // Mensagem genérica ao cliente: não revela qual verificação falhou.
  console.warn(`[chatwoot:webhook:auth] recusado (${motivo})`);
  return new AppError('Webhook não autorizado.', 401, null, true);
}

async function verifyChatwootWebhook(req, res, next) {
  try {
    if (guard.bypassPermitido('CHATWOOT_WEBHOOK_AUTH_DISABLED')) {
      console.warn('[chatwoot:webhook:auth] verificação DESLIGADA (somente dev/teste).');
      return next();
    }

    const { segredo, token, tolerancia } = configuracao();
    if (!segredo && !token) {
      console.error('[chatwoot:webhook:auth] sem CHATWOOT_WEBHOOK_SECRET/TOKEN: webhook bloqueado.');
      return next(new AppError('Webhook Chatwoot não configurado.', 503, null, true));
    }

    const assinatura = `${req.get('x-chatwoot-signature') || ''}`.trim();

    if (assinatura) {
      if (!segredo) return next(recusar('assinatura sem segredo configurado'));
      const m = SHA256_HEX.exec(assinatura);
      const ts = `${req.get('x-chatwoot-timestamp') || ''}`.trim();
      if (!m || !/^\d{9,12}$/.test(ts)) return next(recusar('cabecalhos de assinatura malformados'));

      const esperado = guard.hmacHex(
        'sha256',
        segredo,
        Buffer.concat([Buffer.from(`${ts}.`, 'utf8'), guard.getRawBody(req)])
      );
      if (!guard.safeEqual(esperado, m[1].toLowerCase())) return next(recusar('assinatura invalida'));

      const desvio = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
      if (desvio > tolerancia) return next(recusar('timestamp fora da janela'));

      const entrega = `${req.get('x-chatwoot-delivery') || ''}`.trim().slice(0, 128) || m[1].toLowerCase();
      const primeira = await guard.claimOnce(`chatwoot:delivery:${entrega}`, tolerancia * 2);
      if (!primeira) {
        return responderSucesso(res, { duplicado: true }, 'Entrega já processada.', 200);
      }
      req.chatwootAuth = { modo: 'assinatura' };
      return next();
    }

    const enviado = `${req.get('x-chatwoot-webhook-token') || ''}`.trim();
    if (token && enviado && guard.safeEqual(token, enviado)) {
      req.chatwootAuth = { modo: 'token' };
      return next();
    }
    return next(recusar('credencial ausente ou invalida'));
  } catch (err) {
    return next(err);
  }
}

module.exports = { verifyChatwootWebhook };
