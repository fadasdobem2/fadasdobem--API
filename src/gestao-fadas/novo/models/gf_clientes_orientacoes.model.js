'use strict';

/** Banco novo (PostgreSQL da A): `gf_clientes_orientacoes`. Espelha a migração *gestao-fadas-ficha-cliente*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfClientesOrientacoes',
  tabela: 'gf_clientes_orientacoes',
  atributos: {
    id_cliente: { type: DataTypes.STRING(10), allowNull: false, primaryKey: true },
    revisao: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    ativa: { type: DataTypes.BOOLEAN, allowNull: false },
    pendente: { type: DataTypes.BOOLEAN, allowNull: false },
    item: { type: DataTypes.JSONB, allowNull: false },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [{ name: 'gf_clientes_orientacoes_pendente', fields: ['ativa', 'pendente'] }],
});
