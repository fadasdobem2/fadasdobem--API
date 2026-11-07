'use strict';

/** Rotas da Lilly (Maturacao/59). O gate (`gate/rotas-lilly.js`) monta esta lista atrás do token de serviço e da flag `GF_FATIA_LILLY`. */

const c = require('./lilly.controller');

module.exports = [
  { metodo: 'POST', caminho: '/lilly/context', handler: c.contexto },
  { metodo: 'POST', caminho: '/lilly/events/resolve', handler: c.resolverEvento },
  { metodo: 'POST', caminho: '/lilly/actions/validate', handler: c.validarAcao },
  { metodo: 'POST', caminho: '/lilly/actions', handler: c.executarAcao },
  { metodo: 'GET', caminho: '/lilly/actions/:chave', handler: c.conciliarAcao },
  { metodo: 'GET', caminho: '/lilly/schedule-notes', handler: c.notasDoHorario },
];
