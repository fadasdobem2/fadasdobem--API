'use strict';

/** Banco novo (PostgreSQL da A): `gf_welcome`. Espelha a migração *gestao-fadas-banco-novo*. */

const { DataTypes, literal } = require('sequelize');
const { definir, usuario } = require('./_definir');

module.exports = definir({
  nome: 'GfWelcome',
  tabela: 'gf_welcome',
  atributos: {
    id: { type: DataTypes.STRING(32), allowNull: false, primaryKey: true },
    conteudo: { type: DataTypes.JSONB, allowNull: false },
    revisao: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    atualizado_por: usuario(true),
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
});
