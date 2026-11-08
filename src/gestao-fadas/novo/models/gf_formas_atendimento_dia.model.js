'use strict';

/** Banco novo (PostgreSQL da A): `gf_formas_atendimento_dia`. Espelha a migração *gestao-fadas-formas-atendimento*. */

const { DataTypes } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfFormasAtendimentoDia',
  tabela: 'gf_formas_atendimento_dia',
  atributos: {
    tarologo_id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true },
    data_operacional: { type: DataTypes.DATEONLY, allowNull: false, primaryKey: true },
    formas: { type: DataTypes.JSONB, allowNull: false },
    revisao: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    atualizado_em: { type: DataTypes.DATE, allowNull: false },
    atualizado_por: { type: DataTypes.STRING(160), allowNull: false },
  },
  indexes: [{ name: 'gf_formas_atendimento_dia_data', fields: ['data_operacional'] }],
});
