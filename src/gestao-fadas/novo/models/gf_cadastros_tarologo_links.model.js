'use strict';

/** Banco novo (PostgreSQL da A): `gf_cadastros_tarologo_links`. Espelha a migração *gestao-fadas-cadastros*. */

const { DataTypes, literal } = require('sequelize');
const { definir, referencia } = require('./_definir');

module.exports = definir({
  nome: 'GfCadastrosTarologoLinks',
  tabela: 'gf_cadastros_tarologo_links',
  atributos: {
    id_cadastro: { ...referencia('gf_cadastros_tarologo', 'id', false, 100), primaryKey: true },
    token_hash: { type: DataTypes.STRING(64), allowNull: false },
    revisao_emitida: { type: DataTypes.INTEGER, allowNull: false },
    expira_em: { type: DataTypes.DATE, allowNull: false },
    consumido_em: { type: DataTypes.DATE, allowNull: true },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
  },
  indexes: [{ name: 'uq_cadastros_links_token', fields: ['token_hash'], unique: true }],
});
