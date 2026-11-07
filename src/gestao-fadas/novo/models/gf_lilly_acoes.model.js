'use strict';

/** Banco novo (PostgreSQL da A): `gf_lilly_acoes`. Espelha a migração *gestao-fadas-lilly*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfLillyAcoes',
  tabela: 'gf_lilly_acoes',
  atributos: {
    chave_interna: { type: DataTypes.STRING(200), allowNull: false, primaryKey: true },
    chave_original: { type: DataTypes.TEXT, allowNull: false },
    hash_corpo: { type: DataTypes.STRING(64), allowNull: false },
    kind: { type: DataTypes.STRING(48), allowNull: false },
    estado: { type: DataTypes.STRING(16), allowNull: false },
    resultado: { type: DataTypes.JSONB, allowNull: true },
    evento_origem: { type: DataTypes.STRING(200), allowNull: true },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
  indexes: [{ name: 'gf_lilly_acoes_estado', fields: ['estado', 'atualizado_em'] }],
});
