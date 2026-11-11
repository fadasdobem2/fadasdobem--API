'use strict';

/** Banco novo (PostgreSQL da A): `gf_clientes_novos`. Espelha a migração *gestao-fadas-lilly-v708*. Cliente criada pela Lilly, sem linha em `usuarios`. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfClientesNovos',
  tabela: 'gf_clientes_novos',
  atributos: {
    id_cliente: { type: DataTypes.STRING(10), allowNull: false, primaryKey: true },
    nome: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
    nome_id: { type: DataTypes.STRING(50), allowNull: false, defaultValue: '' },
    nome2: { type: DataTypes.STRING(50), allowNull: false, defaultValue: '' },
    data_nascimento: { type: DataTypes.DATEONLY, allowNull: true },
    telefone: { type: DataTypes.STRING(45), allowNull: true },
    email: { type: DataTypes.STRING(320), allowNull: true },
    origem: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'lilly' },
    source_contact_id: { type: DataTypes.STRING(160), allowNull: true },
    source_conversation_id: { type: DataTypes.STRING(160), allowNull: true },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [
    { name: 'gf_clientes_novos_telefone', fields: ['telefone'] },
    { name: 'uq_clientes_novos_operation_key', fields: ['operation_key'], unique: true },
  ],
});
