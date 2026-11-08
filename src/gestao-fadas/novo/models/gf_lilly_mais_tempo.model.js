'use strict';

/** Banco novo (PostgreSQL da A): `gf_lilly_mais_tempo`. Espelha a migração *gestao-fadas-lilly-v708*. Pedido de mais tempo: registro, nunca minutos. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfLillyMaisTempo',
  tabela: 'gf_lilly_mais_tempo',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    consulta_id: { type: DataTypes.STRING(64), allowNull: false },
    ciclo: { type: DataTypes.INTEGER, allowNull: false },
    id_cliente: { type: DataTypes.STRING(10), allowNull: false },
    id_tarologo: { type: DataTypes.STRING(64), allowNull: false },
    solicitado_em: { type: DataTypes.DATE, allowNull: false },
    source_event_id: { type: DataTypes.STRING(200), allowNull: false },
    source_conversation_id: { type: DataTypes.STRING(160), allowNull: true },
    rotulo: { type: DataTypes.STRING(60), allowNull: false },
    altera_duracao: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    encerra_consulta: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
  indexes: [
    { name: 'uq_lilly_mais_tempo_ciclo', fields: ['consulta_id', 'ciclo'], unique: true },
    { name: 'uq_lilly_mais_tempo_evento', fields: ['source_event_id'], unique: true },
  ],
});
