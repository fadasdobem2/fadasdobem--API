'use strict';

/** Banco novo (PostgreSQL da A): `gf_lilly_avisos`. Espelha a migração *gestao-fadas-lilly*. */

const { DataTypes } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfLillyAvisos',
  tabela: 'gf_lilly_avisos',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    conversation_id: { type: DataTypes.STRING(160), allowNull: false },
    id_cliente: { type: DataTypes.STRING(10), allowNull: true },
    appointment_id: { type: DataTypes.STRING(64), allowNull: true },
    message_id: { type: DataTypes.STRING(160), allowNull: true },
    sent_at: { type: DataTypes.DATE, allowNull: false },
    autor: { type: DataTypes.STRING(120), allowNull: true },
  },
  indexes: [
    { name: 'gf_lilly_avisos_conversa', fields: ['conversation_id', 'sent_at'] },
    { name: 'gf_lilly_avisos_agendamento', fields: ['appointment_id'] },
  ],
});
