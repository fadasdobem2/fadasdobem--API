'use strict';

/**
 * Rotas das fatias Agenda e Ordem da fila, do contrato 28 (seção 2.3). Não é um Router: é a lista que o gate
 * (`gate/rotas-agenda.js`) monta com a cadeia da B (método, sessão, permissão, parâmetros, leitura/gravação).
 * Leitura: `canViewAgenda`; gravação: `canManageConsultations`. `POST /agenda/queues/:tarotId/order` vem antes de `/agenda/:id/...`.
 */

const c = require('./agenda.controller');
const adm = require('./agenda-admissao.controller');
const fila = require('./agenda-fila.controller');

module.exports = [
  { metodo: 'GET', caminho: '/agenda', escrita: false, handler: c.ler },
  { metodo: 'POST', caminho: '/agenda/queues/:tarotId/order', escrita: true, handler: c.ordenar },
  // Admissão do turno e solicitações vêm ANTES de `/agenda/:id` (o mesmo caminho de dois segmentos).
  { metodo: 'GET', caminho: '/agenda/admissions', escrita: false, handler: adm.lerAdmissoes },
  { metodo: 'POST', caminho: '/agenda/admissions', escrita: true, handler: adm.registrarAdmissao },
  { metodo: 'GET', caminho: '/agenda/requests', escrita: false, handler: adm.lerSolicitacoes },
  // Quem pede é a taróloga (`canViewOwnAgenda`); a equipe só resolve.
  { metodo: 'POST', caminho: '/agenda/requests', escrita: true, capacidade: 'canViewOwnAgenda', handler: adm.registrarSolicitacao },
  { metodo: 'POST', caminho: '/agenda/requests/:id/resolve', escrita: true, handler: adm.resolverSolicitacao },
  { metodo: 'POST', caminho: '/agenda', escrita: true, handler: c.criar },
  { metodo: 'PATCH', caminho: '/agenda/:id', escrita: true, handler: c.editar },
  { metodo: 'POST', caminho: '/agenda/:id/contact', escrita: true, handler: c.contato },
  { metodo: 'POST', caminho: '/agenda/:id/refund-request', escrita: true, handler: c.contato },
  { metodo: 'POST', caminho: '/agenda/:id/observations', escrita: true, handler: c.observacoes },
  { metodo: 'POST', caminho: '/agenda/:id/departures', escrita: true, handler: c.saidas },
  { metodo: 'POST', caminho: '/agenda/:id/requested-wait', escrita: true, handler: c.prazo },
  { metodo: 'POST', caminho: '/agenda/:id/resolution', escrita: true, handler: c.resolucao },
  { metodo: 'POST', caminho: '/agenda/:id/route-general', escrita: true, handler: fila.encaminhar },
  { metodo: 'POST', caminho: '/agenda/:id/schedule-general', escrita: true, handler: fila.agendar },
  { metodo: 'POST', caminho: '/agenda/:id/reservation/release', escrita: true, handler: fila.liberar },
];
