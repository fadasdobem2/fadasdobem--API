'use strict';

/** Banco novo (PostgreSQL da A): `gf_horarios_excecoes`. Espelha a migração *gestao-fadas-horarios*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfHorariosExcecoes',
  tabela: 'gf_horarios_excecoes',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_tarologo: { type: DataTypes.STRING(64), allowNull: false },
    data_inicio: { type: DataTypes.DATEONLY, allowNull: false },
    data_fim: { type: DataTypes.DATEONLY, allowNull: false },
    absence_type: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'Nenhuma' },
    today_hours: { type: DataTypes.STRING(200), allowNull: false },
    observacao: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    updated_at_texto: { type: DataTypes.STRING(40), allowNull: false },
    note_updated_at: { type: DataTypes.STRING(40), allowNull: true },
    note_start_date: { type: DataTypes.DATEONLY, allowNull: true },
    note_end_date: { type: DataTypes.DATEONLY, allowNull: true },
    command_id: { type: DataTypes.STRING(64), allowNull: true },
    roster_actor: { type: DataTypes.STRING(120), allowNull: true },
    roster_at: { type: DataTypes.STRING(40), allowNull: true },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    operation_key: { type: DataTypes.STRING(64), allowNull: false },
    removida_em: { type: DataTypes.DATE, allowNull: true },
  },
  indexes: [
    { name: 'gf_horarios_excecoes_busca', fields: ['id_tarologo', 'data_inicio', 'data_fim'] },
    { name: 'uq_horarios_excecoes_ativa', fields: ['id_tarologo', 'data_inicio', 'data_fim'], unique: true, where: { removida_em: null } },
  ],
});
