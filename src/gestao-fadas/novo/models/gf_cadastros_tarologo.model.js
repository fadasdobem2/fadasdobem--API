'use strict';

/** Banco novo (PostgreSQL da A): `gf_cadastros_tarologo`. Espelha a migração *gestao-fadas-cadastros*. */

const { DataTypes, Op, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfCadastrosTarologo',
  tabela: 'gf_cadastros_tarologo',
  atributos: {
    id: { type: DataTypes.STRING(100), allowNull: false, primaryKey: true },
    dados: { type: DataTypes.JSONB, allowNull: false },
    status: { type: DataTypes.STRING(10), allowNull: false },
    revisao: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    tarot_id: { type: DataTypes.STRING(100), allowNull: true },
    aprovado_dados: { type: DataTypes.JSONB, allowNull: true },
    aprovado_publico: { type: DataTypes.JSONB, allowNull: true },
    aprovado_revisao: { type: DataTypes.INTEGER, allowNull: true },
    aprovado_em: { type: DataTypes.DATE, allowNull: true },
    aprovado_por: { type: DataTypes.STRING(120), allowNull: true },
    envio_original: { type: DataTypes.JSONB, allowNull: true },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_por: { type: DataTypes.STRING(120), allowNull: false },
  },
  indexes: [
    { name: 'uq_cadastros_tarologo_tarot', fields: ['tarot_id'], unique: true, where: { tarot_id: { [Op.ne]: null } } },
    { name: 'gf_cadastros_tarologo_recentes', fields: [{ name: 'atualizado_em', order: 'DESC' }] },
  ],
});
