'use strict';

/** Banco novo (PostgreSQL da A): `gf_pendencias_encaminhamentos`. Espelha a migração *gestao-fadas-pendencias*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfPendenciasEncaminhamentos',
  tabela: 'gf_pendencias_encaminhamentos',
  atributos: {
    chave: { type: DataTypes.STRING(300), allowNull: false, primaryKey: true },
    fila: { type: DataTypes.STRING(14), allowNull: false },
    resolvida: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    item: { type: DataTypes.JSONB, allowNull: false },
    version: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [{ name: 'gf_pendencias_fila', fields: ['fila', 'resolvida'] }],
});
