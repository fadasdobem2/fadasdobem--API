'use strict';

/**
 * Rotas da fatia Recados (Maturacao/30). Lista que o gate (`gate/rotas-recados.js`) monta com a cadeia da B. A taróloga passa na permissão
 * (`tarologa: true`) e o service confere o `tarotId` dela e o que a regra de visibilidade deixa ver.
 */

const c = require('./recados.controller');

module.exports = [
  { metodo: 'GET', caminho: '/notes', flag: 'GF_FATIA_RECADOS', capacidade: 'canViewConsultations', escrita: false, tarologa: true, handler: c.lerRecados },
  { metodo: 'PUT', caminho: '/notes/:id', flag: 'GF_FATIA_RECADOS', capacidade: 'canManageConsultations', escrita: true, tarologa: true, handler: c.gravarRecado },
];
