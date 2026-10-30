const { Router } = require('express');
const specialistsController = require('./specialists.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const { requireUserRole, USER_ROLES } = require('../../middlewares/authorization.middleware');

const router = Router();

/** Painel taróloga — montar sempre antes das rotas com parâmetro dinâmico `/:id`. */
router.patch(
  '/me/profile',
  authMiddleware,
  requireUserRole(USER_ROLES.TAROLOGA),
  specialistsController.patchMyProfile
);
router.patch('/me/status', authMiddleware, requireUserRole(USER_ROLES.TAROLOGA), specialistsController.patchMyStatus);
router.put('/me/schedule', authMiddleware, requireUserRole(USER_ROLES.TAROLOGA), specialistsController.putMySchedule);

/** Vitrine pública */
router.get('/', specialistsController.list);
router.get('/:id', specialistsController.detailPublic);

module.exports = router;
