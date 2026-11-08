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

/**
 * Contexto financeiro REAL da cliente (o mesmo de `saldoDaCliente` e do término da consulta: `{ payments, consultations, profile }`) mais o resumo de
 * cobertura (`availableMinutes`, `benefitMinutes`, `canLaunch`, `postpaid`). `null` com a fatia de pagamentos desligada (o término da consulta também
 * não confere saldo nesse caso). Falha de leitura sobe: cobertura NUNCA vira "coberta" por falta de leitura.
 */
function contextoFinanceiro(clientId) {
  const ciclo = require('../../consultas-ciclo/ciclo.financeiro');
  if (!ciclo.pagamentosLigado()) return Promise.resolve(null);
  const fin = require('../../financeiro-cliente/fin.contexto');
  const saldo = require('../../../_comum/dominio/financeiro-saldo');
  return lendoNovo(async (m) => {
    const ext = await m.GfClientesExt.findOne({ where: { id_cliente: `${clientId}` } });
    const c = await fin.carregar(fin.porModelos(m), `${clientId}`, { perfilPagamento: (ext && ext.perfil_pagamento) || '' });
    const resumo = fin.resumir(c);
    const cobertura = saldo.coberturaDaCliente(`${clientId}`, c.payments, c.consultations, c.profile);
    return { payments: c.payments, consultations: c.consultations, profile: c.profile, resumo: { availableMinutes: resumo.availableMinutes, availableCents: resumo.availableCents, benefitMinutes: resumo.benefitMinutes, canLaunch: cobertura.canLaunch, postpaid: cobertura.postpaid } };
  });
}

/** `revision` do snapshot (contexto/revisao.js). Trocável em teste. */
const revisaoDoSnapshot = (agora) => require('./revisao').revisaoAtual(agora);

module.exports = { catalogoTarologos, saldoDaCliente, contextoFinanceiro, revisaoDoSnapshot };
