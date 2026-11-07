'use strict';

/** Banco novo (PostgreSQL da A): `gf_lilly_eventos`. Espelha a migração *gestao-fadas-lilly*. Só acrescenta (gatilho). */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfLillyEventos',
  tabela: 'gf_lilly_eventos',
  atributos: {
    id: { type: DataTypes.STRING(200), allowNull: false, primaryKey: true },
    source: { type: DataTypes.STRING(10), allowNull: false },
    at: { type: DataTypes.DATE, allowNull: false },
    conversation_id: { type: DataTypes.STRING(160), allowNull: true },
    contact_id: { type: DataTypes.STRING(160), allowNull: true },
    message_id: { type: DataTypes.STRING(160), allowNull: true },
    actor: { type: DataTypes.STRING(12), allowNull: false },
    internal: { type: DataTypes.BOOLEAN, allowNull: false },
    id_cliente: { type: DataTypes.STRING(10), allowNull: true },
    tarologist_id: { type: DataTypes.STRING(64), allowNull: true },
    text: { type: DataTypes.TEXT, allowNull: true },
    data: { type: DataTypes.JSONB, allowNull: false },
    provider_meta: { type: DataTypes.JSONB, allowNull: true },
    staff_authorized: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    staff_id: { type: DataTypes.STRING(160), allowNull: true },
    recebido_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
  indexes: [
    { name: 'gf_lilly_eventos_conversa', fields: ['conversation_id', 'at'] },
    { name: 'gf_lilly_eventos_cliente', fields: ['id_cliente'] },
  ],
});
