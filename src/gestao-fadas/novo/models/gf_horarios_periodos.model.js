'use strict';

/** Banco novo (PostgreSQL da A): `gf_horarios_periodos`. Espelha a migração *gestao-fadas-horarios*. */

const { DataTypes } = require('sequelize');
const { definir, referencia } = require('./_definir');

module.exports = definir({
  nome: 'GfHorariosPeriodos',
  tabela: 'gf_horarios_periodos',
  atributos: {
    id_excecao: { ...referencia('gf_horarios_excecoes', 'id', false), primaryKey: true },
    ordem: { type: DataTypes.SMALLINT, allowNull: false, primaryKey: true },
    inicio: { type: DataTypes.TIME, allowNull: false },
    fim: { type: DataTypes.TIME, allowNull: false },
  },
});
