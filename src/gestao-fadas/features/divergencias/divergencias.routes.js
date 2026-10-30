'use strict';

/**
 * Rotas da fatia Divergências (Maturacao/31). Não é um Router: é a lista que o gate (`gate/rotas-divergencias.js`) monta com a cadeia da B.
 * A taróloga passa (`tarologa: true`) só no que é dela: o service confere o `tarotId` da sessão e o repórter da divergência.
 */

const c = require('./divergencias.controller');

module.exports = [
  { metodo: 'GET', caminho: '/divergences', flag: 'GF_FATIA_DIVERGENCIAS', capacidade: 'canViewDivergences', escrita: false, tarologa: true, handler: c.lerDivergencias },
  { metodo: 'PUT', caminho: '/divergences/:id', flag: 'GF_FATIA_DIVERGENCIAS', capacidade: 'canViewDivergences', escrita: true, tarologa: true, handler: c.gravarDivergencia },
];
