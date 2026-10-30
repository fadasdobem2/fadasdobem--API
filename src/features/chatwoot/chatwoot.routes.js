const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const chatwootController = require('./chatwoot.controller');
const { verifyChatwootWebhook } = require('./chatwoot.webhook.auth');

const router = Router();

/** Freio por IP antes da autenticação (o Chatwoot é um remetente só; o teto é folgado). */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.CHATWOOT_WEBHOOK_RATE_LIMIT_PER_MIN) || 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { sucesso: false, mensagem: 'Muitas requisições.' },
});

router.post('/webhook', webhookLimiter, verifyChatwootWebhook, chatwootController.handleWebhook);

module.exports = router;
