'use strict';

/** Banco novo (PostgreSQL da A): `gf_restricoes`. Espelha a migração *gestao-fadas-financeiro-cliente*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfRestricoes',
  tabela: 'gf_restricoes',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_cliente: { type: DataTypes.STRING(10), allowNull: false },
    id_tarologo: { type: DataTypes.STRING(64), allowNull: false },
    solicitante: { type: DataTypes.STRING(10), allowNull: false },
    ativa: { type: DataTypes.BOOLEAN, allowNull: false },
    item: { type: DataTypes.JSONB, allowNull: false },
    version: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [
    { name: 'gf_restricoes_cliente', fields: ['id_cliente'] },
    { name: 'gf_restricoes_tarologo', fields: ['id_tarologo'] },
    { name: 'uq_restricoes_ativa', fields: ['id_cliente', 'id_tarologo', 'solicitante'], unique: true, where: { ativa: true } },
  ],
});
