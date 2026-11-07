'use strict';

/** Banco novo (PostgreSQL da A): `gf_lilly_cotacoes`. Espelha a migração *gestao-fadas-lilly*. */

const { DataTypes } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfLillyCotacoes',
  tabela: 'gf_lilly_cotacoes',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    conversation_id: { type: DataTypes.STRING(160), allowNull: false },
    id_cliente: { type: DataTypes.STRING(10), allowNull: true },
    current: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    amount_centavos: { type: DataTypes.BIGINT, allowNull: false },
    minutes: { type: DataTypes.INTEGER, allowNull: false },
  },
  indexes: [{ name: 'gf_lilly_cotacoes_conversa', fields: ['conversation_id', 'created_at'] }],
});
