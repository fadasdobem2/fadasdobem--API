'use strict';

/** Banco novo (PostgreSQL da A): `gf_log_operacional`. Espelha a migração *gestao-fadas-estado-financeiro*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfLogOperacional',
  tabela: 'gf_log_operacional',
  atributos: {
    id: { type: DataTypes.STRING(200), allowNull: false, primaryKey: true },
    categoria: { type: DataTypes.STRING(20), allowNull: false },
    ocorrido_em: { type: DataTypes.DATE, allowNull: true },
    item: { type: DataTypes.JSONB, allowNull: false },
    registrado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    registrado_por: { type: DataTypes.STRING(120), allowNull: false },
    conta_id: { type: DataTypes.STRING(64), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [{ name: 'gf_log_operacional_quando', fields: ['ocorrido_em', 'registrado_em'] }],
});
