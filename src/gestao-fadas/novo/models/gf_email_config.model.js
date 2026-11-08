'use strict';

/** Banco novo (PostgreSQL da A): `gf_email_config`. Espelha a migração *gestao-fadas-email*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfEmailConfig',
  tabela: 'gf_email_config',
  atributos: {
    id: { type: DataTypes.SMALLINT, allowNull: false, primaryKey: true },
    revisao: { type: DataTypes.INTEGER, allowNull: false },
    conteudo: { type: DataTypes.JSONB, allowNull: false },
    segredos: { type: DataTypes.JSONB, allowNull: false },
    atualizado_por: { type: DataTypes.STRING(160), allowNull: false },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
});
