'use strict';

/** Banco novo (PostgreSQL da A): `gf_legado_intencoes`. Espelha a migração *gestao-fadas-legado-fonte* (Maturacao/46). */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfLegadoIntencoes',
  tabela: 'gf_legado_intencoes',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    entidade: { type: DataTypes.STRING(16), allowNull: false },
    entidade_id: { type: DataTypes.STRING(64), allowNull: false },
    escopo: { type: DataTypes.STRING(80), allowNull: true },
    operation_key: { type: DataTypes.STRING(128), allowNull: true },
    legado_id: { type: DataTypes.STRING(20), allowNull: true },
    antes: { type: DataTypes.JSONB, allowNull: true },
    depois: { type: DataTypes.JSONB, allowNull: true },
    estado: { type: DataTypes.STRING(12), allowNull: false },
    detalhe: { type: DataTypes.STRING(300), allowNull: true },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
  indexes: [{ name: 'gf_legado_intencoes_estado', fields: ['estado', 'atualizado_em'] }, { name: 'gf_legado_intencoes_entidade', fields: ['entidade', 'entidade_id'] }],
});
