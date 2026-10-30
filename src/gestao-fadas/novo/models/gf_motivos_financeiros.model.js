'use strict';

/** Banco novo (PostgreSQL da A): `gf_motivos_financeiros`. Espelha a migração *gestao-fadas-estado-financeiro*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfMotivosFinanceiros',
  tabela: 'gf_motivos_financeiros',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    item: { type: DataTypes.JSONB, allowNull: false },
    version: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
});
