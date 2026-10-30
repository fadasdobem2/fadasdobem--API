'use strict';

/** Banco novo (PostgreSQL da A): `gf_repasse_abertura_pendencias`. Espelha a migração *gestao-fadas-banco-novo*. */

const { DataTypes } = require('sequelize');
const { definir, usuario, referencia } = require('./_definir');

module.exports = definir({
  nome: 'GfRepasseAberturaPendencias',
  tabela: 'gf_repasse_abertura_pendencias',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    abertura_id: referencia('gf_repasse_aberturas', 'id', false),
    descricao: { type: DataTypes.STRING(500), allowNull: false },
    valor: { type: DataTypes.DECIMAL(20, 2), allowNull: true },
    resolvida_em: { type: DataTypes.BIGINT, allowNull: true },
    resolvida_por: usuario(true),
  },
});
