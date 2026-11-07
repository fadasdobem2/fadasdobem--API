'use strict';

/** Banco novo (PostgreSQL da A): `gf_contas_ext`. Espelha a migração *gestao-fadas-contas-config*. */

const { DataTypes, Op, literal } = require('sequelize');
const { definir, usuario } = require('./_definir');

module.exports = definir({
  nome: 'GfContasExt',
  tabela: 'gf_contas_ext',
  atributos: {
    user_id: { ...usuario(false), primaryKey: true },
    legacy_id: { type: DataTypes.STRING(64), allowNull: true },
    avatar: { type: DataTypes.TEXT, allowNull: true },
    revisao: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    acesso_pendente: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    convite_hash: { type: DataTypes.CHAR(64), allowNull: true },
    convite_tipo: { type: DataTypes.STRING(16), allowNull: true },
    convite_email: { type: DataTypes.STRING(320), allowNull: true },
    convite_papel: { type: DataTypes.STRING(16), allowNull: true },
    convite_emitido: { type: DataTypes.DATE, allowNull: true },
    convite_expira: { type: DataTypes.DATE, allowNull: true },
    convite_usado: { type: DataTypes.DATE, allowNull: true },
    convite_revogado: { type: DataTypes.DATE, allowNull: true },
    ver_minutagem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    permissoes_trilha: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_por: usuario(true),
  },
  indexes: [
    { name: 'uq_contas_ext_convite_hash', fields: ['convite_hash'], unique: true, where: { convite_hash: { [Op.ne]: null } } },
  ],
});
