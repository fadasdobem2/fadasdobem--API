'use strict';

/**
 * Models do sistema B (Gestão Fadas) sobre o banco LEGADO + tabelas novas `gf_*`.
 *
 *   tabelas/  tabelas do ASP32 (legado). SOMENTE LEITURA. Geradas do catálogo.
 *   novas/    tabelas `gf_*`, ligadas ao legado por ID. Geradas dos SQL versionados.
 *
 * Fica separado de `src/models/index.js` de propósito: é OUTRO banco (MySQL) e OUTRA conexão. Nada daqui é
 * carregado se o legado não estiver configurado. Uso:
 *
 *   const { iniciarLegado } = require('../models/legado');
 *   const { models } = iniciarLegado();          // lança LegadoNaoConfiguradoError se faltar LEGADO_DB_*
 *   await models.LegadoTarologo.findAll({ include: [{ model: models.GfTarologosExt, as: 'extensao' }] });
 *
 * Regras (ver src/gestao-fadas/README.md): não se altera tabela legada; dado novo vai para tabela nova.
 */

const conexao = require('./connection');
const associar = require('./associations');

let cache = null;

function iniciarLegado() {
  if (cache) return cache;
  const sequelize = conexao.getLegadoSequelize();
  const fabricas = [...require('./tabelas'), ...require('./novas')];
  const models = {};
  for (const fabrica of fabricas) {
    models[fabrica.NOME] = fabrica(sequelize);
  }
  associar(models);
  cache = { sequelize, models };
  return cache;
}

async function encerrarLegado() {
  cache = null;
  await conexao.fecharLegado();
}

/** Nomes de todos os models, sem abrir conexão (útil em testes e na documentação). */
function listarModelos() {
  const nomes = (lista) => lista.map((f) => ({ nome: f.NOME, tabela: f.TABELA }));
  return { legado: nomes(require('./tabelas')), novas: nomes(require('./novas')) };
}

module.exports = {
  iniciarLegado,
  encerrarLegado,
  listarModelos,
  legadoConfigurado: conexao.legadoConfigurado,
  statusLegado: conexao.statusLegado,
  LegadoNaoConfiguradoError: conexao.LegadoNaoConfiguradoError,
  ...require('./somente-leitura'),
};
