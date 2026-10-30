'use strict';

/** Banco novo (PostgreSQL da A): `gf_contas_ext`. Espelha a migração *gestao-fadas-contas-config*. */

const { DataTypes, literal } = require('sequelize');
const { definir, usuario } = require('./_definir');

module.exports = definir({
  nome: 'GfContasExt',
  tabela: 'gf_contas_ext',
  atributos: {
    user_id: { ...usuario(false), primaryKey: true },
    legacy_id: { type: DataTypes.STRING(64), allowNull: true },
    avatar: { type: DataTypes.TEXT, allowNull: true },
    revisao: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_por: usuario(true),
  },
});
