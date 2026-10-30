'use strict';

const { Router } = require('express');
const jobController = require('./job-applications.admin.controller');

const router = Router();

router.get('/', jobController.list);
router.get('/:id', jobController.getById);
router.patch('/:id/estado', jobController.patchEstado);

module.exports = router;
