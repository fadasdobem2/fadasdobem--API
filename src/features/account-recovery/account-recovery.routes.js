'use strict';

const { Router } = require('express');
const authMiddleware = require('../../middlewares/auth.middleware');
const controller = require('./account-recovery.controller');
const {
  loginRegisterIpLimiter,
  registerDailyIpLimiter,
} = require('../../middlewares/rateLimit.middleware');

const router = Router();

// Público — cria conta temporária + solicitação de recuperação
router.post(
  '/request',
  loginRegisterIpLimiter,
  registerDailyIpLimiter,
  controller.createRequest
);

// Autenticado — usuário acompanha e interage com a própria solicitação
router.get('/status', authMiddleware, controller.getStatus);
router.post('/message', authMiddleware, controller.sendMessage);

module.exports = router;
