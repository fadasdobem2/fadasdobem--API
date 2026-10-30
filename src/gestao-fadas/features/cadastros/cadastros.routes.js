'use strict';

/**
 * Rotas do catálogo (Maturacao/29 seção 9). Lista `{ metodo, caminho, escrita, handler }` que o gate (`gate/rotas-cadastros.js`) monta com a
 * cadeia da B (método, sessão, permissão, parâmetros, leitura/gravação). As permissões finas (perfil x recurso) ficam nos services.
 */

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const tarologos = require('./tarologos.service');
const clientes = require('./clientes.service');

const h = (fn, msg) => catchAsyncRoute(async (req, res) => responderSucesso(res, await fn(req), msg, 200));

module.exports = [
  { metodo: 'GET', caminho: '/catalog/tarologists', escrita: false, handler: h(tarologos.ler, 'Catálogo de tarólogos.') },
  { metodo: 'PUT', caminho: '/catalog/tarologists/:tarotId/profile', escrita: true, handler: h(tarologos.gravarPerfil, 'Perfil registrado.') },
  { metodo: 'PUT', caminho: '/catalog/tarologists/:tarotId/account', escrita: true, handler: h(tarologos.vincularConta, 'Conta vinculada.') },
  { metodo: 'GET', caminho: '/catalog/clients', escrita: false, handler: h(clientes.ler, 'Extensões de cliente.') },
  { metodo: 'PATCH', caminho: '/catalog/clients/:id', escrita: true, handler: h(clientes.gravar, 'Cadastro registrado.') },
];
