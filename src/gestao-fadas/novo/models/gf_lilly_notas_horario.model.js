'use strict';

/** Banco novo (PostgreSQL da A): `gf_lilly_notas_horario`. Espelha a migração *gestao-fadas-lilly*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfLillyNotasHorario',
  tabela: 'gf_lilly_notas_horario',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    tarologist_id: { type: DataTypes.STRING(64), allowNull: false },
    data_operacional: { type: DataTypes.DATEONLY, allowNull: false },
    schedule_id: { type: DataTypes.STRING(64), allowNull: true },
    expected_at: { type: DataTypes.DATE, allowNull: true },
    ends_at: { type: DataTypes.DATE, allowNull: true },
    status: { type: DataTypes.STRING(10), allowNull: false },
    texto: { type: DataTypes.TEXT, allowNull: false },
    conversation_id: { type: DataTypes.STRING(160), allowNull: true },
    message_id: { type: DataTypes.STRING(160), allowNull: true },
    at: { type: DataTypes.DATE, allowNull: false },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
  indexes: [{ name: 'gf_lilly_notas_horario_dia', fields: ['tarologist_id', 'data_operacional'] }],
});
