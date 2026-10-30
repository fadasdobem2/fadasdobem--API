'use strict';

/** Banco novo (PostgreSQL da A): `gf_presenca_estado`. Espelha a migração *gestao-fadas-presenca*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfPresencaEstado',
  tabela: 'gf_presenca_estado',
  atributos: {
    id_tarologo: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    shift_status: { type: DataTypes.STRING(12), allowNull: false },
    shift_exit: { type: DataTypes.STRING(12), allowNull: true },
    pause_reason: { type: DataTypes.STRING(20), allowNull: true },
    presence_date: { type: DataTypes.DATEONLY, allowNull: true },
    expected_return: { type: DataTypes.DATE, allowNull: true },
    return_until: { type: DataTypes.DATE, allowNull: true },
    return_forecast: { type: DataTypes.JSONB, allowNull: true },
    shift_available_since: { type: DataTypes.DATE, allowNull: true },
    presence_last_activity_at: { type: DataTypes.DATE, allowNull: true },
    presence_confirmed_at: { type: DataTypes.DATE, allowNull: true },
    presence_schedule_updated_at: { type: DataTypes.DATE, allowNull: true },
    confirmed_period_date: { type: DataTypes.DATEONLY, allowNull: true },
    confirmed_period_start_at: { type: DataTypes.DATE, allowNull: true },
    confirmed_period_end_at: { type: DataTypes.DATE, allowNull: true },
    revisao: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
});
