'use strict';

/** Banco novo (PostgreSQL da A): `gf_saldos_partida`. Espelha a migração *gestao-fadas-financeiro-cliente*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfSaldosPartida',
  tabela: 'gf_saldos_partida',
  atributos: {
    id_cliente: { type: DataTypes.STRING(10), allowNull: false, primaryKey: true },
    centavos: { type: DataTypes.BIGINT, allowNull: false },
    fonte: { type: DataTypes.STRING(60), allowNull: false },
    congelado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    congelado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
});
