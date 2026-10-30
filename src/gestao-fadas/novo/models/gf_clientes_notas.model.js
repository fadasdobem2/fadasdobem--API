'use strict';

/** Banco novo (PostgreSQL da A): `gf_clientes_notas`. Espelha a migração *gestao-fadas-ficha-cliente*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfClientesNotas',
  tabela: 'gf_clientes_notas',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_cliente: { type: DataTypes.STRING(10), allowNull: false },
    item: { type: DataTypes.JSONB, allowNull: false },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
    legado_id: { type: DataTypes.STRING(10), allowNull: true },
    legado_estado: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'nao_espelhada' },
    legado_detalhe: { type: DataTypes.STRING(300), allowNull: true },
    legado_atualizado_em: { type: DataTypes.DATE, allowNull: true },
  },
  indexes: [{ name: 'gf_clientes_notas_cliente', fields: ['id_cliente', 'criado_em'] }],
});
