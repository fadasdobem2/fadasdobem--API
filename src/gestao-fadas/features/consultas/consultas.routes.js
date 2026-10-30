'use strict';

const { Router } = require('express');
const { requirePermission } = require('../../../middlewares/authorization.middleware');
const { exigirCapacidade } = require('../../_comum/politica-acesso');
const controller = require('./consultas.controller');

const router = Router();

// Exportação do recorte inteiro (B: GET /api/operations/consultations/export). Mesmas permissões da lista.
router.get('/export', requirePermission('consultas.ver'), exigirCapacidade('canReadRealOperations'), controller.exportar);
router.get('/', requirePermission('consultas.ver'), exigirCapacidade('canReadRealOperations'), controller.listar);

module.exports = router;
