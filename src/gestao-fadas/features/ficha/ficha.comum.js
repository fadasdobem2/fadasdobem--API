'use strict';

/**
 * Peças comuns da fatia Ficha da cliente (Maturacao/36): quem age (equipe, nunca a taróloga), a conferência de que o id é de uma cliente do
 * legado (SOMENTE LEITURA, `clienteExiste`) e a tradução dos erros de domínio em 422 com a mensagem do front.
 */

const AppError = require('../../../utils/AppError');
const f = require('../financeiro-cliente/fin.comum');
const { OrientacaoInvalidaError } = require('../../_comum/dominio/orientacao-financeira');
const { NotaInvalidaError } = require('../../_comum/dominio/nota-cliente');

let verificarCliente = async (id) => require('../clientes/clientes.service').clienteExiste(id);
/** Troca a conferência do legado (os verificadores com banco descartável não têm MySQL). */
const definirVerificadorDeCliente = (fn) => { verificarCliente = fn; };
async function exigirCliente(id) {
  if (!(await verificarCliente(id))) throw new AppError('Cadastro de cliente não encontrado.', 404, { codigo: 'CLIENT_NOT_FOUND' }, true);
}

const traduzir = (e) => (e instanceof OrientacaoInvalidaError || e instanceof NotaInvalidaError ? f.regra(e.message) : e);
/** Equipe com `canViewClients` (a taróloga não entra). */
const atorDe = (req, escrita = false) => f.ator(req, { permissao: 'canViewClients', escrita });

module.exports = { f, definirVerificadorDeCliente, exigirCliente, traduzir, atorDe };
