'use strict';

/**
 * Escolhe o executor de escrita pelo modo (`GF_NOVOS_DADOS`, ver modo.js) a CADA chamada, com a interface de
 * src/models/legado/escrita.js. Padrão `postgres` (banco novo); `mysql` mantém o executor do banco do suspiro.
 * No modo postgres o MySQL legado nunca é tocado: este arquivo só carrega o executor MySQL se o modo pedir.
 */

const { novosDadosNoPostgres } = require('./modo');

const atual = () => (novosDadosNoPostgres() ? require('./banco-novo') : require('../../models/legado/escrita'));

module.exports = {
  emTransacao: (...a) => atual().emTransacao(...a),
  emEnsaio: (...a) => atual().emEnsaio(...a),
  executarAvulso: (...a) => atual().executarAvulso(...a),
  fecharEscrita: (...a) => atual().fecharEscrita(...a),
  escritaHabilitada: () => process.env.GESTAO_FADAS_ESCRITA_ENABLED === 'true',
};
