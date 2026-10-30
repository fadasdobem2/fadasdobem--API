'use strict';

/** Banco novo (PostgreSQL da A): `gf_presenca_confirmacoes`. Espelha a migração *gestao-fadas-presenca*. */

const { DataTypes } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfPresencaConfirmacoes',
  tabela: 'gf_presenca_confirmacoes',
  atributos: {
    id_tarologo: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    reason: { type: DataTypes.STRING(12), allowNull: false },
    requested_at: { type: DataTypes.DATE, allowNull: false },
    deadline_at: { type: DataTypes.DATE, allowNull: true },
    offline_at: { type: DataTypes.DATE, allowNull: true },
    idle_timeout_ms: { type: DataTypes.BIGINT, allowNull: true },
    limpa_em: { type: DataTypes.DATE, allowNull: true },
  },
});
