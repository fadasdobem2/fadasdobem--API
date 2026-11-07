'use strict';

/** Banco novo (PostgreSQL da A): `gf_cadastros_tarologo_novos_links`. Espelha a migração *gestao-fadas-cadastros-links-novos*. */

const { DataTypes } = require('sequelize');
const { definir, referencia } = require('./_definir');

module.exports = definir({
  nome: 'GfCadastrosTarologoNovosLinks',
  tabela: 'gf_cadastros_tarologo_novos_links',
  atributos: {
    id: { type: DataTypes.STRING(100), allowNull: false, primaryKey: true },
    token_hash: { type: DataTypes.STRING(64), allowNull: false },
    emitido_em: { type: DataTypes.DATE, allowNull: false },
    expira_em: { type: DataTypes.DATE, allowNull: false },
    consumido_em: { type: DataTypes.DATE, allowNull: true },
    revogado_em: { type: DataTypes.DATE, allowNull: true },
    id_cadastro: referencia('gf_cadastros_tarologo', 'id', true, 100),
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
  },
  indexes: [
    { name: 'uq_cadastros_novos_links_token', fields: ['token_hash'], unique: true },
    { name: 'gf_cadastros_novos_links_recentes', fields: [{ name: 'emitido_em', order: 'DESC' }] },
  ],
});
