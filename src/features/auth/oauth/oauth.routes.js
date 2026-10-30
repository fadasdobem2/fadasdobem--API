'use strict';

const { Router } = require('express');
const authMiddleware = require('../../../middlewares/auth.middleware');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const { responderSucesso } = require('../../../utils/response.util');
const oauthHandlers = require('./oauth.controller');
const oauthService = require('./oauth.service');
const { loginRegisterIpLimiter } = require('../../../middlewares/rateLimit.middleware');

const router = Router();

router.get('/status', oauthHandlers.statusOAuth);

router.get(
  '/google/start',
  loginRegisterIpLimiter,
  catchAsyncRoute(async (req, res) => oauthHandlers.startOAuth(req, res, 'google'))
);

router.get(
  '/google/callback',
  catchAsyncRoute(async (req, res) => oauthHandlers.handleOAuthCallback(req, res, 'google'))
);

router.get(
  '/facebook/start',
  loginRegisterIpLimiter,
  catchAsyncRoute(async (req, res) => oauthHandlers.startOAuth(req, res, 'facebook'))
);

router.get(
  '/facebook/callback',
  catchAsyncRoute(async (req, res) => oauthHandlers.handleOAuthCallback(req, res, 'facebook'))
);

router.post(
  '/complete-profile',
  authMiddleware,
  catchAsyncRoute(async (req, res) => {
    const dados = await oauthService.completeOAuthProfile(req.user.id, req.body || {});
    return responderSucesso(res, dados, 'Perfil completado.', 200);
  })
);

module.exports = router;
