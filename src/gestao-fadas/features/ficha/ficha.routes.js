'use strict';

/** Rotas da fatia Ficha da cliente (Maturacao/36). Lista que o gate (`gate/rotas-ficha.js`) monta com a cadeia da B. Só equipe (`canViewClients`). */

const c = require('./ficha.controller');

const FLAG = 'GF_FATIA_FICHA';
module.exports = [
  { metodo: 'GET', caminho: '/client-guidance', flag: FLAG, capacidade: 'canViewClients', escrita: false, handler: c.lerOrientacoes },
  { metodo: 'PUT', caminho: '/client-guidance', flag: FLAG, capacidade: 'canViewClients', escrita: true, handler: c.gravarOrientacao },
  { metodo: 'GET', caminho: '/client-notes', flag: FLAG, capacidade: 'canViewClients', escrita: false, handler: c.lerNotas },
  { metodo: 'PUT', caminho: '/client-notes', flag: FLAG, capacidade: 'canViewClients', escrita: true, handler: c.gravarNota },
];
