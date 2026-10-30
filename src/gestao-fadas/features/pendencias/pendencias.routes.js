'use strict';

/** Rotas da fatia Pendências (Maturacao/34). Lista que o gate (`gate/rotas-pendencias.js`) monta com a cadeia da B. Só equipe (a taróloga não vê Pendências). */

const c = require('./pendencias.controller');

module.exports = [
  { metodo: 'GET', caminho: '/pending-routing', flag: 'GF_FATIA_PENDENCIAS', capacidade: 'canViewConsultations', escrita: false, handler: c.lerEncaminhamentos },
  { metodo: 'GET', caminho: '/pending-routing/derived', flag: 'GF_FATIA_PENDENCIAS', capacidade: 'canViewConsultations', escrita: false, handler: c.lerDerivadas },
  { metodo: 'PUT', caminho: '/pending-routing', flag: 'GF_FATIA_PENDENCIAS', capacidade: 'canViewConsultations', escrita: true, handler: c.gravarEncaminhamento },
];
