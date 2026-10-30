'use strict';

/** Banco novo (PostgreSQL da A): `gf_cadastros_tarologo_envios`. Espelha a migração *gestao-fadas-cadastros*. */

const { DataTypes, literal } = require('sequelize');
const { definir, referencia } = require('./_definir');

module.exports = definir({
  nome: 'GfCadastrosTarologoEnvios',
  tabela: 'gf_cadastros_tarologo_envios',
  atributos: {
    chave_hash: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    impressao: { type: DataTypes.STRING(64), allowNull: false },
    id_cadastro: referencia('gf_cadastros_tarologo', 'id', false, 100),
    recebido_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
});
