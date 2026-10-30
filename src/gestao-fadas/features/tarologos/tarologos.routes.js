'use strict';

const { Router } = require('express');
const { requirePermission } = require('../../../middlewares/authorization.middleware');
const { exigirCapacidade } = require('../../_comum/politica-acesso');
const controller = require('./tarologos.controller');

const router = Router();

router.get('/', requirePermission('tarologas.ver'), exigirCapacidade('canReadRealOperations'), controller.listar);
router.get('/:id', requirePermission('tarologas.ver'), exigirCapacidade('canReadRealOperations'), controller.obter);

module.exports = router;
