'use strict';

/** Banco novo (PostgreSQL da A): `gf_agenda_contatos` (contato que ainda não é cliente, código IL). Espelha a migração *gestao-fadas-agenda-contatos*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfAgendaContatos',
  tabela: 'gf_agenda_contatos',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    codigo: { type: DataTypes.STRING(16), allowNull: true },
    item: { type: DataTypes.JSONB, allowNull: false },
    version: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [{ name: 'uq_agenda_contatos_codigo', fields: ['codigo'], unique: true }],
});
