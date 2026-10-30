const { Router } = require('express');
const authController = require('./auth.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const {
  loginRegisterIpLimiter,
  loginEmailLimiter,
  registerDailyIpLimiter,
  forgotPasswordEmailHourLimiter,
  forgotPasswordPhoneHourLimiter,
  forgotPasswordIpDayLimiter,
} = require('../../middlewares/rateLimit.middleware');

const router = Router();

const oauthRoutes = require('./oauth/oauth.routes');

/**
 * Emissor de CSRF token. Público (não requer auth) — chamado pelo front antes do login.
 * Após login/refresh, um novo token é embutido na resposta dessas rotas para manter
 * o token sincronizado com a nova `sessionIdentifier`.
 */
router.get('/csrf-token', authController.csrfToken);

router.use('/oauth', oauthRoutes);

router.post(
  '/register',
  loginRegisterIpLimiter,
  loginEmailLimiter,
  registerDailyIpLimiter,
  authController.register
);
router.post('/login', loginRegisterIpLimiter, loginEmailLimiter, authController.login);
router.post('/refresh-token', authController.refreshToken);
router.post(
  '/forgot-password',
  forgotPasswordEmailHourLimiter,
  forgotPasswordPhoneHourLimiter,
  forgotPasswordIpDayLimiter,
  authController.forgotPassword
);
router.post('/reset-password', authController.resetPassword);
router.get('/verify-email', authController.verifyEmail);

router.get('/staff-invite/preview', authController.previewStaffInvite);
router.post('/staff-invite/accept', authController.acceptStaffInvite);

router.get('/me', authMiddleware, authController.getMe);
router.patch('/me', authMiddleware, authController.patchMe);
router.post('/logout', authMiddleware, authController.logout);
router.post('/resend-verification', authMiddleware, authController.resendVerification);

module.exports = router;
