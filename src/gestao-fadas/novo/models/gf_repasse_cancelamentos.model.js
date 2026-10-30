'use strict';

/** Banco novo (PostgreSQL da A): `gf_repasse_cancelamentos`. Espelha a migração *gestao-fadas-banco-novo*. */

const { DataTypes } = require('sequelize');
const { definir, usuario } = require('./_definir');

module.exports = definir({
  nome: 'GfRepasseCancelamentos',
  tabela: 'gf_repasse_cancelamentos',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    consulta_id: { type: DataTypes.STRING(16), allowNull: false },
    tarot_id: { type: DataTypes.STRING(16), allowNull: false },
    cliente_id: { type: DataTypes.STRING(16), allowNull: false },
    queixa: { type: DataTypes.TEXT, allowNull: false },
    situacao: { type: DataTypes.STRING(10), allowNull: false },
    motivo_decisao: { type: DataTypes.STRING(1000), allowNull: true },
    registrado_por: usuario(),
    registrado_em: { type: DataTypes.BIGINT, allowNull: false },
    decidido_por: usuario(true),
    decidido_em: { type: DataTypes.BIGINT, allowNull: true },
    operation_key: { type: DataTypes.STRING(64), allowNull: false },
  },
  indexes: [
    { name: 'uq_cancelamentos_consulta', fields: ['consulta_id'], unique: true },
    { name: 'uq_cancelamentos_operation_key', fields: ['operation_key'], unique: true },
    { name: 'idx_cancelamentos_tarot', fields: ['tarot_id'] },
  ],
});
