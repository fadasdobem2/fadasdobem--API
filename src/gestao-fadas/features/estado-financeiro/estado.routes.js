'use strict';

/**
 * Rotas da fatia Estado financeiro (Maturacao/43). Lista que o gate (`gate/rotas-estado-financeiro.js`) monta com a cadeia da B. Motivos e Adicionais: só equipe
 * (`canViewConsultations`; a regra por perfil de cada gravação está no serviço). Trilha: a leitura é da administradora (no serviço) e a gravação aceita a taróloga.
 */

const c = require('./estado.controller');

const FLAG = 'GF_FATIA_ESTADO_FINANCEIRO';
module.exports = [
  { metodo: 'GET', caminho: '/financial-reasons', flag: FLAG, capacidade: 'canViewConsultations', escrita: false, handler: c.lerMotivos },
  { metodo: 'PUT', caminho: '/financial-reasons', flag: FLAG, capacidade: 'canViewConsultations', escrita: true, handler: c.gravarMotivo },
  { metodo: 'GET', caminho: '/payout-additions', flag: FLAG, capacidade: 'canViewConsultations', escrita: false, handler: c.lerAdicionais },
  { metodo: 'PUT', caminho: '/payout-additions', flag: FLAG, capacidade: 'canViewConsultations', escrita: true, handler: c.gravarAdicional },
  { metodo: 'GET', caminho: '/operation-audit', flag: FLAG, capacidade: 'canViewConsultations', escrita: false, handler: c.lerLog },
  { metodo: 'POST', caminho: '/operation-audit', flag: FLAG, capacidade: 'canViewConsultations', escrita: true, tarologa: true, handler: c.gravarLog },
];
