'use strict';

const { Router } = require('express');
const { requirePermission } = require('../../../middlewares/authorization.middleware');
const { exigirCapacidade } = require('../../_comum/politica-acesso');
const controller = require('./pagamentos.controller');

const router = Router();

/**
 * Recebimentos de clientes (R5: informado x confirmado x não localizado x conferir a origem). RBAC `dinheiro.recebimentos`.
 *   GET /pagamentos/recebimentos?start&end&by=paid|launched&page   (B: GET /api/operations/receipts)
 *   GET /pagamentos/recebimentos/sem-data?page                     (B: GET /api/operations/receipts/undated)
 * A rota literal `sem-data` vem antes de qualquer rota parametrizada.
 *   GET /pagamentos/recebimentos/export?start&end&by                (B: GET /api/operations/receipts/export, R23: .xlsx do recorte inteiro)
 */
router.get('/recebimentos/export', requirePermission('dinheiro.recebimentos'), exigirCapacidade('canReadRealOperations'), controller.exportar);
router.get('/recebimentos/sem-data', requirePermission('dinheiro.recebimentos'), exigirCapacidade('canReadRealOperations'), controller.listarSemDataPaga);
router.get('/recebimentos', requirePermission('dinheiro.recebimentos'), exigirCapacidade('canReadRealOperations'), controller.listar);

module.exports = router;
