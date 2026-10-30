'use strict';

const { Router } = require('express');
const authMiddleware = require('../../middlewares/auth.middleware');
const { requireUserRole, USER_ROLES } = require('../../middlewares/authorization.middleware');
const payoutsController = require('./payouts.controller');

const router = Router();

router.post('/request', authMiddleware, requireUserRole(USER_ROLES.TAROLOGA), payoutsController.postRequest);
router.get('/me', authMiddleware, requireUserRole(USER_ROLES.TAROLOGA), payoutsController.listMine);

module.exports = router;
