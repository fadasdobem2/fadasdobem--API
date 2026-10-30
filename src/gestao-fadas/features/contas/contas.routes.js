'use strict';

/** Lista que o gate (`gate/rotas-contas.js`) monta com a cadeia da B. Todas exigem a administradora (conferido no service). */
const c = require('./contas.controller');

module.exports = [
  { metodo: 'GET', caminho: '/accounts', escrita: false, handler: c.ler },
  { metodo: 'POST', caminho: '/accounts', escrita: true, handler: c.criar },
  { metodo: 'PATCH', caminho: '/accounts/:id', escrita: true, handler: c.editar },
  { metodo: 'POST', caminho: '/accounts/:id/password', escrita: true, handler: c.senha },
  { metodo: 'POST', caminho: '/accounts/:id/active', escrita: true, handler: c.ativo },
];
