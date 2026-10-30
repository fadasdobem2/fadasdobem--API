'use strict';

/** Banco novo (PostgreSQL da A): `gf_repasse_divida_parcelas`. Espelha a migração *gestao-fadas-banco-novo*. */

const { DataTypes } = require('sequelize');
const { definir, referencia } = require('./_definir');

module.exports = definir({
  nome: 'GfRepasseDividaParcelas',
  tabela: 'gf_repasse_divida_parcelas',
  atributos: {
    divida_id: { ...referencia('gf_repasse_dividas', 'id', false), primaryKey: true },
    sequencia: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true },
    data: { type: DataTypes.DATEONLY, allowNull: false },
    valor: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
  },
});
