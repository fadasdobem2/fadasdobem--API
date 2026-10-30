'use strict';

/** Banco novo (PostgreSQL da A): `gf_adicionais_itens`. Espelha a migração *gestao-fadas-estado-financeiro*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfAdicionaisItens',
  tabela: 'gf_adicionais_itens',
  atributos: {
    chave: { type: DataTypes.STRING(200), allowNull: false, primaryKey: true },
    tipo: { type: DataTypes.STRING(10), allowNull: false },
    item: { type: DataTypes.JSONB, allowNull: false },
    version: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [{ name: 'gf_adicionais_tipo', fields: ['tipo', 'criado_em'] }],
});
