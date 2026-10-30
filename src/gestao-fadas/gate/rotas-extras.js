'use strict';

/**
 * Exportações .xlsx e gravações no contrato da B. Cada item é `{ metodo, caminho, handler, capacidade?, escrita? }`
 * (ver rotas-operacoes.js). Os handlers são os mesmos das features; o corpo JSON é lido aqui (o gate responde antes
 * do parser global quando montado cedo).
 *
 * Gravações: a conta que assina vem da sessão da B (`req.user.gfContaId`), que é a conta de `gf_auth_accounts`.
 */

const express = require('express');
const consultas = require('../features/consultas/consultas.controller');
const pagamentos = require('../features/pagamentos/pagamentos.controller');
const clientes = require('../features/clientes/clientes.controller');
const escrita = require('../features/repasse/escrita/escrita.controller');
const { exigirEscritaLigada } = require('../features/repasse/escrita/escrita.flag');

const json = express.json({ limit: '100kb' });
const corpo = (handler) => [json, handler];
// Gravação de repasse: flag R24 primeiro (desligada responde 404, como a B), depois o corpo.
const gravar = (handler) => [exigirEscritaLigada, json, handler];

const definicoes = [
  { metodo: 'GET', caminho: '/operations/consultations/export', capacidade: 'canReadRealOperations', handler: consultas.exportar },
  { metodo: 'GET', caminho: '/operations/receipts/export', capacidade: 'canReadRealOperations', handler: pagamentos.exportar },
  { metodo: 'POST', caminho: '/operations/clients/:id/history-access', escrita: true, handler: corpo(clientes.ampliarHistorico) },
  { metodo: 'POST', caminho: '/payouts/agreements/:tarotId/commission', capacidade: 'canManagePayoutAgreement', escrita: true, handler: gravar(escrita.percentual) },
  { metodo: 'POST', caminho: '/payouts/agreements/:tarotId/schedule', capacidade: 'canManagePayoutAgreement', escrita: true, handler: gravar(escrita.calendario) },
  { metodo: 'POST', caminho: '/payouts/openings', capacidade: 'canManagePayoutOpening', escrita: true, handler: gravar(escrita.rascunho) },
  { metodo: 'POST', caminho: '/payouts/openings/:ref/confirm', capacidade: 'canManagePayoutOpening', escrita: true, handler: gravar(escrita.confirmar) },
  { metodo: 'POST', caminho: '/payouts/openings/:ref/correct', capacidade: 'canManagePayoutOpening', escrita: true, handler: gravar(escrita.corrigir) },
];

module.exports = definicoes;
