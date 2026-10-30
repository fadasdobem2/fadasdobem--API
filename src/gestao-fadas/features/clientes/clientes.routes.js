'use strict';

const { Router } = require('express');
const { requirePermission } = require('../../../middlewares/authorization.middleware');
const controller = require('./clientes.controller');

const router = Router();

// RBAC da A: a lista e a busca pedem `clientes.buscar`; a ficha e os históricos pedem `clientes.ver`. O RECORTE por perfil
// (administradora/assistente/supervisora/atendente) vem do papel do usuário (helpers/perfis.js) e é aplicado no controller.
router.get('/', requirePermission('clientes.buscar'), controller.listar);
router.get('/:id', requirePermission('clientes.ver'), controller.obter);
router.get('/:id/consultations', requirePermission('clientes.ver'), controller.consultas);
router.get('/:id/receipts', requirePermission('clientes.ver'), controller.recebimentos);
// Ampliação do histórico (supervisora): única gravação do contrato da B (grava `clients.history.expand` em gf_auditoria, idempotente por operationKey).
router.post('/:id/history-access', requirePermission('clientes.historico_completo'), controller.ampliarHistorico);

module.exports = router;
