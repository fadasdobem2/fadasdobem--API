'use strict';

/** Banco novo (PostgreSQL da A): `gf_lilly_pagamento_refs`. Espelha a migração *gestao-fadas-lilly*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfLillyPagamentoRefs',
  tabela: 'gf_lilly_pagamento_refs',
  atributos: {
    payment_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    reference: { type: DataTypes.STRING(200), allowNull: true },
    mp_payment_id: { type: DataTypes.STRING(100), allowNull: true },
    external_transaction_id: { type: DataTypes.STRING(200), allowNull: true },
    end_to_end_id: { type: DataTypes.STRING(100), allowNull: true },
    source_event_id: { type: DataTypes.STRING(200), allowNull: true },
    proposal_id: { type: DataTypes.STRING(200), allowNull: true },
    authorized_event_id: { type: DataTypes.STRING(200), allowNull: true },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
  indexes: [
    { name: 'gf_lilly_refs_reference', fields: ['reference'] },
    { name: 'gf_lilly_refs_mp', fields: ['mp_payment_id'] },
    { name: 'gf_lilly_refs_externa', fields: ['external_transaction_id'] },
    { name: 'gf_lilly_refs_e2e', fields: ['end_to_end_id'] },
    { name: 'gf_lilly_refs_evento', fields: ['source_event_id'] },
  ],
});
