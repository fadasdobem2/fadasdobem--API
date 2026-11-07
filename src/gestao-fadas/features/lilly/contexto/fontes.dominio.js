'use strict';

/**
 * Leituras que já têm dono no módulo (catálogo de tarólogos, saldo da cliente): o snapshot reaproveita, não reimplementa. Trocáveis em teste.
 */

const { lendoNovo } = require('../../../novo/leitura');

/** Catálogo de tarólogos (legado `tbl_tarologos` + extensões): `[{ id, name, active, registrationActive, ... }]`. */
function catalogoTarologos() {
  return require('../../cadastros/tarologos.service').catalogo();
}

/**
 * Saldo e perfil de pagamento da cliente, pela mesma conta da tela (`fin.contexto`: abertura da planilha + movimentos). Devolve
 * `{ balance (reais), paymentProfile }`. Falha (legado fora do ar etc.) sobe: o saldo NUNCA vira zero por falta de leitura.
 */
function saldoDaCliente(clientId) {
  const fin = require('../../financeiro-cliente/fin.contexto');
  return lendoNovo(async (m) => {
    const ext = await m.GfClientesExt.findOne({ where: { id_cliente: `${clientId}` } });
    const contexto = await fin.carregar(fin.porModelos(m), `${clientId}`, { perfilPagamento: (ext && ext.perfil_pagamento) || '' });
    return { balance: fin.resumir(contexto).balanceCents / 100, paymentProfile: contexto.profile.paymentProfile || '' };
  });
}

module.exports = { catalogoTarologos, saldoDaCliente };
