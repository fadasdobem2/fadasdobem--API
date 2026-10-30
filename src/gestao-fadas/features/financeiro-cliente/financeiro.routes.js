'use strict';

/**
 * Rotas da fatia Valores, Pagamentos e Restrições (Maturacao/29 seção 10). Não é um Router: é a lista que o gate (`gate/rotas-financeiro.js`)
 * monta com a cadeia da B. `flag` escolhe a variável `GF_FATIA_*` que liga o grupo; `capacidade` é a permissão do perfil (a taróloga só
 * passa onde `tarologa: true`, e o service confere o `tarotId` dela). Nada de pagamento passa pela taróloga.
 */

const c = require('./financeiro.controller');

module.exports = [
  { metodo: 'GET', caminho: '/pricing', flag: 'GF_FATIA_PRECOS', capacidade: 'canViewConsultations', escrita: false, handler: c.lerPrecos },
  { metodo: 'POST', caminho: '/pricing/versions', flag: 'GF_FATIA_PRECOS', capacidade: 'canManageFinancialValues', escrita: true, handler: c.criarVersaoDePreco },
  { metodo: 'GET', caminho: '/payments', flag: 'GF_FATIA_PAGAMENTOS', capacidade: 'canViewRecentPayments', escrita: false, handler: c.lerPagamentos },
  { metodo: 'GET', caminho: '/payments/accounts', flag: 'GF_FATIA_PAGAMENTOS', capacidade: 'canViewRecentPayments', escrita: false, handler: c.contas },
  { metodo: 'POST', caminho: '/payments', flag: 'GF_FATIA_PAGAMENTOS', capacidade: 'canManageConsultations', escrita: true, handler: c.lancarPagamento },
  { metodo: 'POST', caminho: '/payments/benefits', flag: 'GF_FATIA_PAGAMENTOS', capacidade: 'canManageConsultations', escrita: true, handler: c.concederBeneficio },
  { metodo: 'POST', caminho: '/payments/:id/revise', flag: 'GF_FATIA_PAGAMENTOS', capacidade: 'canManageConsultations', escrita: true, handler: c.revisarPagamento },
  { metodo: 'GET', caminho: '/restrictions', flag: 'GF_FATIA_RESTRICOES', capacidade: 'canViewConsultations', escrita: false, tarologa: true, handler: c.lerRestricoes },
  { metodo: 'PUT', caminho: '/restrictions/:id', flag: 'GF_FATIA_RESTRICOES', capacidade: 'canManageConsultations', escrita: true, tarologa: true, handler: c.gravarRestricao },
];
