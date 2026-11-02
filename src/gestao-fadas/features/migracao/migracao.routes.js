'use strict';

/**
 * Rotas da fatia Migração por planilha (Maturacao/55). Não é um Router: é a lista que o gate (`gate/rotas-migracao.js`) monta com a cadeia da B.
 * Leitura: equipe que vê pagamentos. Aplicar e conferir: o service exige a administradora. A taróloga nunca passa.
 */

const c = require('./migracao.controller');

module.exports = [
  { metodo: 'GET', caminho: '/migration/histories', flag: 'GF_FATIA_MIGRACAO', capacidade: 'canViewRecentPayments', escrita: false, handler: c.lerHistoricos },
  { metodo: 'GET', caminho: '/migration/histories/:id', flag: 'GF_FATIA_MIGRACAO', capacidade: 'canViewRecentPayments', escrita: false, handler: c.obterHistorico },
  { metodo: 'POST', caminho: '/migration/apply', flag: 'GF_FATIA_MIGRACAO', capacidade: 'canManageFinancialValues', escrita: true, handler: c.aplicarLote },
  { metodo: 'GET', caminho: '/migration/reconciliation', flag: 'GF_FATIA_MIGRACAO', capacidade: 'canManageFinancialValues', escrita: false, handler: c.conferir },
  { metodo: 'GET', caminho: '/migration/without-sheet', flag: 'GF_FATIA_MIGRACAO', capacidade: 'canManageFinancialValues', escrita: false, handler: c.semPlanilha },
];
