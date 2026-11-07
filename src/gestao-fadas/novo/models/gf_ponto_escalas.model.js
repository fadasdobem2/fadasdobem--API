'use strict';

/** Banco novo (PostgreSQL da A): `gf_ponto_escalas`. Espelha a migração *gestao-fadas-ponto*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfPontoEscalas',
  tabela: 'gf_ponto_escalas',
  atributos: {
    id_conta: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true },
    conteudo: { type: DataTypes.JSONB, allowNull: false },
    revisao: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    atualizado_por: { type: DataTypes.STRING(160), allowNull: false },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
});
