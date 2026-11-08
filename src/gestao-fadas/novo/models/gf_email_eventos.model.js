'use strict';

/** Banco novo (PostgreSQL da A): `gf_email_eventos`. Espelha a migração *gestao-fadas-email*. */

const { DataTypes } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfEmailEventos',
  tabela: 'gf_email_eventos',
  atributos: {
    id: { type: DataTypes.STRING(80), allowNull: false, primaryKey: true },
    ocorreu_em: { type: DataTypes.DATE, allowNull: false },
    ator_id: { type: DataTypes.STRING(160), allowNull: false },
    finalidade: { type: DataTypes.STRING(16), allowNull: false },
    tipo: { type: DataTypes.STRING(16), allowNull: false },
    conta_id: { type: DataTypes.STRING(160), allowNull: true },
    resultado: { type: DataTypes.STRING(16), allowNull: false },
    codigo_erro: { type: DataTypes.STRING(200), allowNull: true },
  },
  indexes: [{ name: 'gf_email_eventos_hora', fields: ['ocorreu_em'] }],
});
