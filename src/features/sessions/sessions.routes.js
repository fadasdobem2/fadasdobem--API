const { Router } = require('express');
const authMiddleware = require('../../middlewares/auth.middleware');
const { requireUserRole, USER_ROLES } = require('../../middlewares/authorization.middleware');
const sessionsController = require('./sessions.controller');
const { verifyAgoraSignature } = require('./sessions.webhooks');

const router = Router();

router.post('/agora-webhook', verifyAgoraSignature, sessionsController.receiveAgoraNcsWebhook);
/**
 * Webhook Intelbras WideVoice — desativado.
 * Ver `src/features/telecom/DESATIVADO.md`. Mantemos só o `agora-webhook`.
 */
router.post('/', authMiddleware, sessionsController.createSession);
router.post('/:id/review', authMiddleware, requireUserRole(USER_ROLES.CLIENTE), sessionsController.submitSessionReview);
router.patch('/:id/ritual', authMiddleware, requireUserRole(USER_ROLES.TAROLOGA), sessionsController.patchSessionRitual);
router.get('/:id/token', authMiddleware, sessionsController.getRtcJoinToken);

module.exports = router;
