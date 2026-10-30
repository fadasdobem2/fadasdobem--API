'use strict';

/** Banco novo (PostgreSQL da A): `gf_presenca_historico`. Espelha a migração *gestao-fadas-presenca*. */

const { DataTypes } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfPresencaHistorico',
  tabela: 'gf_presenca_historico',
  atributos: {
    id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true },
    id_tarologo: { type: DataTypes.STRING(64), allowNull: false },
    ordem: { type: DataTypes.BIGINT, allowNull: false },
    actor_id: { type: DataTypes.STRING(64), allowNull: false },
    actor_name: { type: DataTypes.STRING(200), allowNull: false },
    at: { type: DataTypes.DATE, allowNull: false },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    antes: { type: DataTypes.TEXT, allowNull: false },
    depois: { type: DataTypes.TEXT, allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: true },
  },
  indexes: [{ name: 'uq_presenca_historico_ordem', fields: ['id_tarologo', 'ordem'], unique: true }],
});
