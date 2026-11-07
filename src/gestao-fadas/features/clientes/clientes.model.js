'use strict';

/**
 * Regra pura de CLIENTES (sem banco, sem Express). Porta fiel de features/clientes/real-clients-model.ts do suspiro
 * (spec 004, história 10; research R18 a R20), mais as regras de perfil de real-clients-http.server.ts.
 *
 * As regras de cada perfil (administradora, assistente, supervisora, atendente) são as da v608, aplicadas no servidor
 * antes de qualquer coisa sair. O recorte por perfil vem do `role` recebido (perfil da B); a conversão do papel RBAC da
 * A para esse perfil está em helpers/perfis.js (objeto CONFIGURACAO_PERFIS).
 *
 * Nomes do DTO, chaves e textos em português seguem a B (RealClientListItem, RealClientProfile, current, tarologists,
 * counts, dateCounts, notIntegrated, issues...). Nenhuma credencial (senha, login) entra aqui: as linhas de `usuarios`
 * já chegam pela lista branca de colunas (R18) e o model Sequelize da A nem tem essas colunas.
 */

const { CLIENT_HISTORY_PAGE_SIZE, realClientHistoryPageSize } = require('../../_comum/dominio/cliente-historico-pagina');
const cadastro = require('./clientes.model.cadastro');
const busca = require('./clientes.model.busca');
const plano = require('./clientes.model.plano');
const lista = require('./clientes.model.lista');
const ficha = require('./clientes.model.ficha');
const historico = require('./clientes.model.historico');
const ampliacao = require('./clientes.model.ampliacao');

module.exports = {
  CATALOGOS_VAZIOS: cadastro.CATALOGOS_VAZIOS,
  CLIENT_HISTORY_GRANT_ACTION: ampliacao.CLIENT_HISTORY_GRANT_ACTION,
  CLIENT_HISTORY_PAGE_SIZE,
  CLIENT_ISSUES: cadastro.CLIENT_ISSUES,
  buildRealClientConsultationHistory: historico.buildRealClientConsultationHistory,
  buildRealClientList: lista.buildRealClientList,
  buildRealClientProfile: ficha.buildRealClientProfile,
  buildRealClientReceiptHistory: historico.buildRealClientReceiptHistory,
  clientListRange: plano.clientListRange,
  consultingNow: lista.consultingNow,
  filterAndSortClients: lista.filterAndSortClients,
  isRealClientHistoryGrantFor: ampliacao.isRealClientHistoryGrantFor,
  projectProfile: ficha.projectProfile,
  movementsOf: lista.movementsOf,
  planRealClientHistoryGrant: ampliacao.planRealClientHistoryGrant,
  planRealClientList: plano.planRealClientList,
  readRealClientRow: cadastro.readRealClientRow,
  realClientHistoryDates: historico.realClientHistoryDates,
  realClientHistoryPageSize,
  realClientHistoryScope: historico.realClientHistoryScope,
  realClientListPageInfo: lista.realClientListPageInfo,
  realClientListSelection: lista.realClientListSelection,
  realClientMatches: busca.realClientMatches,
  recordsOf: lista.recordsOf,
  sameRealClientHistoryGrant: ampliacao.sameRealClientHistoryGrant,
  selectRealClientList: lista.selectRealClientList,
};
