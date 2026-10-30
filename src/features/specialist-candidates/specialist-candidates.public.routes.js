'use strict';

const { Router } = require('express');
const controller = require('./specialist-candidates.public.controller');
const {
  trabalheConoscoIpLimiter,
  trabalheConoscoDailyIpLimiter,
} = require('../../middlewares/rateLimit.middleware');

const router = Router();

router.post(
  '/candidates/validate-email',
  trabalheConoscoIpLimiter,
  controller.validateEmail
);

router.post(
  '/candidates',
  trabalheConoscoIpLimiter,
  trabalheConoscoDailyIpLimiter,
  controller.submitF1
);

router.get('/onboarding/:token', controller.getOnboarding);
router.put('/onboarding/:token/f2', controller.submitF2);

module.exports = router;
