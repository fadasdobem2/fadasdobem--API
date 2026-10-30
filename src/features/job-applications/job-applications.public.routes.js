'use strict';

const { Router } = require('express');
const controller = require('./job-applications.public.controller');
const {
  trabalheConoscoIpLimiter,
  trabalheConoscoDailyIpLimiter,
} = require('../../middlewares/rateLimit.middleware');

const router = Router();

router.post(
  '/applications',
  trabalheConoscoIpLimiter,
  trabalheConoscoDailyIpLimiter,
  controller.submit
);

module.exports = router;
