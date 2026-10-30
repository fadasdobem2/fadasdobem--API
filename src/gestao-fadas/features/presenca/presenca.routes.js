'use strict';

/**
 * Rotas da fatia Presença, do contrato 28 (seção 5.3). Não é um Router: é a lista que o gate (`gate/rotas-presenca.js`)
 * monta com a cadeia da B. Leitura: equipe (`canViewSchedules`) ou taróloga no seu tarotId. Escrita: equipe
 * (`canManageConsultations`) ou a taróloga no seu tarotId; `request` e `activity` são só da própria taróloga.
 * `request` não está no contrato 28: é o pedido manual que o front cria ao abrir a página (reader-presence-tracker.tsx:49-65).
 */

const c = require('./presenca.controller');

module.exports = [
  { metodo: 'GET', caminho: '/presence', escrita: false, handler: c.ler },
  { metodo: 'POST', caminho: '/presence/:tarotId/status', escrita: true, handler: c.status },
  { metodo: 'POST', caminho: '/presence/:tarotId/confirm', escrita: true, handler: c.confirmar },
  { metodo: 'POST', caminho: '/presence/:tarotId/request', escrita: true, handler: c.pedir },
  { metodo: 'POST', caminho: '/presence/:tarotId/activity', escrita: true, handler: c.atividade },
];
