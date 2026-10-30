'use strict';

/** Banco novo (PostgreSQL da A): `gf_repasse_calendarios`. Espelha a migração *gestao-fadas-banco-novo*. */

const { DataTypes } = require('sequelize');
const { definir, TimestampSemFuso, usuario } = require('./_definir');

module.exports = definir({
  nome: 'GfRepasseCalendarios',
  tabela: 'gf_repasse_calendarios',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    tarot_id: { type: DataTypes.STRING(16), allowNull: false },
    tipo: { type: DataTypes.STRING(12), allowNull: false },
    dia_semana: { type: DataTypes.STRING(8), allowNull: true },
    dias_mes: { type: DataTypes.STRING(100), allowNull: true },
    politica_fim_semana: { type: DataTypes.STRING(20), allowNull: true },
    vigente_desde: { type: TimestampSemFuso(), allowNull: false },
    motivo: { type: DataTypes.STRING(500), allowNull: true },
    registrado_por: usuario(),
    registrado_em: { type: DataTypes.BIGINT, allowNull: false },
    operation_key: { type: DataTypes.STRING(64), allowNull: false },
  },
  indexes: [
    { name: 'uq_calendarios_vigencia', fields: ['tarot_id', 'vigente_desde'], unique: true },
    { name: 'uq_calendarios_operation_key', fields: ['operation_key'], unique: true },
  ],
});
