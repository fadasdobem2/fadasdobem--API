'use strict';

/** Banco novo (PostgreSQL da A): `gf_operacoes`. Espelha a migração *gestao-fadas-banco-novo*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfOperacoes',
  tabela: 'gf_operacoes',
  atributos: {
    escopo: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    chave: { type: DataTypes.STRING(128), allowNull: false, primaryKey: true },
    hash_corpo: { type: DataTypes.STRING(64), allowNull: false },
    resposta: { type: DataTypes.JSONB, allowNull: true },
    criada_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
});
