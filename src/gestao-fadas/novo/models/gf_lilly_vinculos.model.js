'use strict';

/** Banco novo (PostgreSQL da A): `gf_lilly_vinculos`. Espelha a migração *gestao-fadas-lilly*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfLillyVinculos',
  tabela: 'gf_lilly_vinculos',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_cliente: { type: DataTypes.STRING(10), allowNull: false },
    umbler_contact_id: { type: DataTypes.STRING(160), allowNull: false },
    umbler_conversation_id: { type: DataTypes.STRING(160), allowNull: false },
    verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    attribution: { type: DataTypes.JSONB, allowNull: true },
    first_contact: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
  indexes: [
    { name: 'uq_lilly_vinculos_contato_conversa', fields: ['umbler_contact_id', 'umbler_conversation_id'], unique: true },
    { name: 'gf_lilly_vinculos_cliente', fields: ['id_cliente'] },
    { name: 'gf_lilly_vinculos_conversa', fields: ['umbler_conversation_id'] },
  ],
});
