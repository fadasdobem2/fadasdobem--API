'use strict';

const { Router } = require('express');
const { requirePermission } = require('../../../middlewares/authorization.middleware');
const { exigirCapacidade } = require('../../_comum/politica-acesso');
const controller = require('./repasse.controller');
const escrita = require('./escrita/escrita.controller');
const { exigirEscritaLigada } = require('./escrita/escrita.flag');

const router = Router();

// Leituras: `dinheiro.pagar_tarologas` (na B, `canManagePayouts`: administradora e assistente).
router.get('/tarologos/:id/acordo', requirePermission('dinheiro.pagar_tarologas'), exigirCapacidade('canReadRealOperations'), controller.acordo);
router.get('/tarologos/:id/aberturas', requirePermission('dinheiro.pagar_tarologas'), exigirCapacidade('canReadRealOperations'), controller.aberturas);

// Gravações (porta dos POST de `real-payouts-http.server.ts`; caminhos da B sob /payouts). Só a administradora altera o
// acordo e a abertura (`canManagePayoutAgreement` / `canManagePayoutOpening`); a assistente só lê. A RBAC `dinheiro.pagar_tarologas`
// é a mais próxima que existe (também abre a assistente, que a capacidade da B barra com 403). A flag R24 vem PRIMEIRO: desligada
// (produção, ou sem GESTAO_FADAS_ESCRITA_ENABLED) a rota responde 404 antes de qualquer outra coisa.
const escrever = (capacidade) => [exigirEscritaLigada, requirePermission('dinheiro.pagar_tarologas'), exigirCapacidade(capacidade, { escrita: true })];
router.post('/payouts/agreements/:tarotId/commission', ...escrever('canManagePayoutAgreement'), escrita.percentual);
router.post('/payouts/agreements/:tarotId/schedule', ...escrever('canManagePayoutAgreement'), escrita.calendario);
router.post('/payouts/openings', ...escrever('canManagePayoutOpening'), escrita.rascunho);
router.post('/payouts/openings/:ref/confirm', ...escrever('canManagePayoutOpening'), escrita.confirmar);
router.post('/payouts/openings/:ref/correct', ...escrever('canManagePayoutOpening'), escrita.corrigir);

module.exports = router;
