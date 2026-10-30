'use strict';

/**
 * Rotas da fatia Horários e escala, do contrato 28 (seção 5.3). Não é um Router: é a lista que o gate
 * (`gate/rotas-horarios.js`) monta com a cadeia da B (método, sessão, permissão, parâmetros, leitura/gravação).
 * `leitura`: equipe `canViewSchedules` ou taróloga no seu tarotId; `escrita`: `canEditSchedule`.
 */

const c = require('./horarios.controller');

module.exports = [
  { metodo: 'GET', caminho: '/schedules', escrita: false, handler: c.ler },
  { metodo: 'PUT', caminho: '/schedules/:tarotId/weekly', escrita: true, handler: c.gravarSemanal },
  { metodo: 'PUT', caminho: '/schedules/:tarotId/overrides', escrita: true, handler: c.gravarExcecao },
  { metodo: 'DELETE', caminho: '/schedules/:tarotId/overrides/:key', escrita: true, handler: c.removerExcecao },
];
