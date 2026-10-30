'use strict';

/** Banco novo (PostgreSQL da A): `gf_divergencias`. Espelha a migração *gestao-fadas-divergencias*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfDivergencias',
  tabela: 'gf_divergencias',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    tipo: { type: DataTypes.STRING(12), allowNull: false },
    area: { type: DataTypes.STRING(12), allowNull: false },
    situacao: { type: DataTypes.STRING(16), allowNull: false },
    id_cliente: { type: DataTypes.STRING(10), allowNull: true },
    id_tarologo: { type: DataTypes.STRING(64), allowNull: true },
    id_reportador: { type: DataTypes.STRING(64), allowNull: true },
    id_consulta: { type: DataTypes.STRING(64), allowNull: true },
    id_pagamento: { type: DataTypes.STRING(64), allowNull: true },
    excluida: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    item: { type: DataTypes.JSONB, allowNull: false },
    version: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [
    { name: 'gf_divergencias_situacao', fields: ['situacao', 'excluida'] },
    { name: 'gf_divergencias_cliente', fields: ['id_cliente'] },
    { name: 'gf_divergencias_reportador', fields: ['id_reportador'] },
    { name: 'gf_divergencias_consulta', fields: ['id_consulta'] },
  ],
});
