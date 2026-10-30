'use strict';

/**
 * Rotas das fatias Consulta (5 a 7) do contrato 28 (seção 4.3). Não é um Router: é a lista que o gate (`gate/rotas-consulta.js`) monta
 * com a cadeia da B. Todas sob `/consultations`; a taróloga passa na permissão e o service confere o `tarotId` dela.
 * Substituiu os 25 caminhos do contrato por 11: `revise` cobre, com conferência por comando, o que o front calcula com saldo e valores
 * (ver Maturacao/29 seção 8.3).
 */

const c = require('./ciclo.controller');

module.exports = [
  { metodo: 'GET', caminho: '/consultations', escrita: false, handler: c.ler },
  { metodo: 'GET', caminho: '/panel/sources', escrita: false, handler: c.fontesDoPainel },
  { metodo: 'POST', caminho: '/consultations', escrita: true, handler: c.lancar },
  { metodo: 'POST', caminho: '/consultations/:id/start', escrita: true, handler: c.iniciar },
  { metodo: 'POST', caminho: '/consultations/:id/pause', escrita: true, handler: c.pausar },
  { metodo: 'POST', caminho: '/consultations/:id/resume', escrita: true, handler: c.retomar },
  { metodo: 'POST', caminho: '/consultations/:id/finish', escrita: true, handler: c.termino },
  { metodo: 'POST', caminho: '/consultations/:id/finish-by-staff', escrita: true, handler: c.terminoPelaEquipe },
  { metodo: 'POST', caminho: '/consultations/:id/cancel-by-reader', escrita: true, handler: c.devolver },
  { metodo: 'POST', caminho: '/consultations/:id/more-time', escrita: true, handler: c.maisTempo },
  { metodo: 'POST', caminho: '/consultations/:id/finish/correction-request', escrita: true, handler: c.correcao },
  { metodo: 'POST', caminho: '/consultations/:id/revise', escrita: true, handler: c.revisar },
];
