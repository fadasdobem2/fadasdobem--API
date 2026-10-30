'use strict';

/** Banco novo (PostgreSQL da A): `gf_precos_versoes`. Espelha a migração *gestao-fadas-financeiro-cliente*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfPrecosVersoes',
  tabela: 'gf_precos_versoes',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    vigente_desde: { type: DataTypes.DATE, allowNull: false },
    item: { type: DataTypes.JSONB, allowNull: false },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [{ name: 'gf_precos_versoes_vigencia', fields: ['vigente_desde', 'criado_em'] }],
});
