'use strict';

/** Banco novo (PostgreSQL da A): `gf_escalas_semanais`. Espelha a migração *gestao-fadas-horarios*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfEscalasSemanais',
  tabela: 'gf_escalas_semanais',
  atributos: {
    id_tarologo: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    weekday: { type: DataTypes.STRING(8), allowNull: false, primaryKey: true },
    hours: { type: DataTypes.STRING(200), allowNull: false },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
});
