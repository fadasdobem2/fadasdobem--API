'use strict';

/** Banco novo (PostgreSQL da A): `gf_auditoria`. Espelha a migração *gestao-fadas-banco-novo*. */

const { DataTypes } = require('sequelize');
const { definir, usuario } = require('./_definir');

module.exports = definir({
  nome: 'GfAuditoria',
  tabela: 'gf_auditoria',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    ocorrido_em: { type: DataTypes.BIGINT, allowNull: false },
    ator_conta_id: usuario(),
    ator_funcao: { type: DataTypes.STRING(32), allowNull: false },
    acao: { type: DataTypes.STRING(64), allowNull: false },
    entidade: { type: DataTypes.STRING(64), allowNull: false },
    entidade_id: { type: DataTypes.STRING(64), allowNull: false },
    antes: { type: DataTypes.JSONB, allowNull: true },
    depois: { type: DataTypes.JSONB, allowNull: true },
    motivo: { type: DataTypes.STRING(1000), allowNull: true },
    operation_key: { type: DataTypes.STRING(64), allowNull: false },
  },
  indexes: [
    { name: 'uq_auditoria_operation_key', fields: ['operation_key'], unique: true },
    { name: 'idx_auditoria_entidade', fields: ['entidade', 'entidade_id', 'ocorrido_em'] },
  ],
});
