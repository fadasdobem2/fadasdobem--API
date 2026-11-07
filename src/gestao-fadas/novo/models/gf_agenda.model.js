'use strict';

/** Banco novo (PostgreSQL da A): `gf_agenda`. Espelha a migração *gestao-fadas-agenda*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfAgenda',
  tabela: 'gf_agenda',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    numero_publico: { type: DataTypes.INTEGER, allowNull: false },
    id_tarologo: { type: DataTypes.STRING(64), allowNull: false },
    id_cliente: { type: DataTypes.STRING(64), allowNull: true },
    id_contato: { type: DataTypes.STRING(64), allowNull: true },
    data_operacional: { type: DataTypes.DATEONLY, allowNull: false },
    posicao: { type: DataTypes.INTEGER, allowNull: false },
    agenda_outcome: { type: DataTypes.STRING(12), allowNull: true },
    item: { type: DataTypes.JSONB, allowNull: false },
    version: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [
    { name: 'uq_agenda_numero_publico', fields: ['numero_publico'], unique: true },
    { name: 'gf_agenda_dia_tarologo', fields: ['data_operacional', 'id_tarologo'] },
    { name: 'gf_agenda_cliente', fields: ['id_cliente'] },
    { name: 'gf_agenda_contato', fields: ['id_contato'] },
  ],
});
