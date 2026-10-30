'use strict';

/** Banco novo (PostgreSQL da A): `gf_tarologos_perfil`. Espelha a migração *gestao-fadas-cadastros*. */

const { DataTypes, Op, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfTarologosPerfil',
  tabela: 'gf_tarologos_perfil',
  atributos: {
    tarot_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_legado: { type: DataTypes.INTEGER, allowNull: true },
    conta_slug: { type: DataTypes.STRING(64), allowNull: true },
    nome: { type: DataTypes.STRING(120), allowNull: true },
    avatar: { type: DataTypes.TEXT, allowNull: true },
    cadastro_ativo: { type: DataTypes.BOOLEAN, allowNull: true },
    perfil: { type: DataTypes.JSONB, allowNull: false, defaultValue: literal("'{}'::jsonb") },
    registro_id: { type: DataTypes.STRING(100), allowNull: true },
    registro_revisao: { type: DataTypes.INTEGER, allowNull: true },
    revisao: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: true },
  },
  indexes: [
    { name: 'uq_tarologos_perfil_legado', fields: ['id_legado'], unique: true, where: { id_legado: { [Op.ne]: null } } },
    { name: 'uq_tarologos_perfil_conta', fields: ['conta_slug'], unique: true, where: { conta_slug: { [Op.ne]: null } } },
    { name: 'uq_tarologos_perfil_registro', fields: ['registro_id'], unique: true, where: { registro_id: { [Op.ne]: null } } },
  ],
});
