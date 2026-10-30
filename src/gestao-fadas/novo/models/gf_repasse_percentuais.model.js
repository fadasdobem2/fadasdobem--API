'use strict';

/** Banco novo (PostgreSQL da A): `gf_repasse_percentuais`. Espelha a migração *gestao-fadas-banco-novo*. */

const { DataTypes } = require('sequelize');
const { definir, TimestampSemFuso, usuario } = require('./_definir');

module.exports = definir({
  nome: 'GfRepassePercentuais',
  tabela: 'gf_repasse_percentuais',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    tarot_id: { type: DataTypes.STRING(16), allowNull: false },
    percentual: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
    vigente_desde: { type: TimestampSemFuso(), allowNull: false },
    motivo: { type: DataTypes.STRING(500), allowNull: true },
    registrado_por: usuario(),
    registrado_em: { type: DataTypes.BIGINT, allowNull: false },
    operation_key: { type: DataTypes.STRING(64), allowNull: false },
  },
  indexes: [
    { name: 'uq_percentuais_vigencia', fields: ['tarot_id', 'vigente_desde'], unique: true },
    { name: 'uq_percentuais_operation_key', fields: ['operation_key'], unique: true },
  ],
});
