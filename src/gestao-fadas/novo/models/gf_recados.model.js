'use strict';

/** Banco novo (PostgreSQL da A): `gf_recados`. Espelha a migração *gestao-fadas-recados*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfRecados',
  tabela: 'gf_recados',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_tarologo: { type: DataTypes.STRING(64), allowNull: false },
    origem: { type: DataTypes.STRING(12), allowNull: false },
    id_ator: { type: DataTypes.STRING(64), allowNull: true },
    id_resposta_a: { type: DataTypes.STRING(64), allowNull: true },
    excluido: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    item: { type: DataTypes.JSONB, allowNull: false },
    version: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [
    { name: 'gf_recados_tarologo', fields: ['id_tarologo'] },
    { name: 'gf_recados_resposta', fields: ['id_resposta_a'] },
    { name: 'gf_recados_ator', fields: ['id_ator'] },
  ],
});
