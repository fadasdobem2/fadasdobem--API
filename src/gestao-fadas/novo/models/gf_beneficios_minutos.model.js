'use strict';

/** Banco novo (PostgreSQL da A): `gf_beneficios_minutos`. Espelha a migração *gestao-fadas-financeiro-cliente*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfBeneficiosMinutos',
  tabela: 'gf_beneficios_minutos',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_cliente: { type: DataTypes.STRING(10), allowNull: false },
    tipo: { type: DataTypes.STRING(10), allowNull: false },
    minutos: { type: DataTypes.INTEGER, allowNull: false },
    item: { type: DataTypes.JSONB, allowNull: false },
    concedido_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    concedido_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [{ name: 'gf_beneficios_minutos_cliente', fields: ['id_cliente', 'concedido_em'] }],
});
