'use strict';

/** Banco novo (PostgreSQL da A): `gf_tarologos_ext`. Espelha a migração *gestao-fadas-banco-novo*. */

const { DataTypes } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfTarologosExt',
  tabela: 'gf_tarologos_ext',
  atributos: {
    id_tarologo: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true },
    foto_atual_ref: { type: DataTypes.STRING(2048), allowNull: true },
    primeiro_nome_civil: { type: DataTypes.STRING(100), allowNull: true },
    name_article: { type: DataTypes.STRING(1), allowNull: true },
    personal_whatsapp: { type: DataTypes.STRING(45), allowNull: true },
    avatar_whatsapp: { type: DataTypes.STRING(45), allowNull: true },
    situacao_turno: { type: DataTypes.STRING(20), allowNull: true },
    retorno_previsto_em: { type: DataTypes.STRING(40), allowNull: true },
  },
});
