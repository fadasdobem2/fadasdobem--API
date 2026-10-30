'use strict';

/** Banco novo (PostgreSQL da A): `gf_repasse_ajustes`. Espelha a migração *gestao-fadas-banco-novo*. */

const { DataTypes } = require('sequelize');
const { definir, usuario, referencia } = require('./_definir');

module.exports = definir({
  nome: 'GfRepasseAjustes',
  tabela: 'gf_repasse_ajustes',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    tarot_id: { type: DataTypes.STRING(16), allowNull: false },
    tipo: { type: DataTypes.STRING(8), allowNull: false },
    valor: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
    descricao: { type: DataTypes.STRING(500), allowNull: false },
    data: { type: DataTypes.DATEONLY, allowNull: false },
    periodo_inicio: { type: DataTypes.DATEONLY, allowNull: false },
    periodo_fim: { type: DataTypes.DATEONLY, allowNull: false },
    abertura_id: referencia('gf_repasse_aberturas'),
    situacao: { type: DataTypes.STRING(12), allowNull: false },
    corrige_id: referencia('gf_repasse_ajustes'),
    motivo_correcao: { type: DataTypes.STRING(500), allowNull: true },
    registrado_por: usuario(),
    registrado_em: { type: DataTypes.BIGINT, allowNull: false },
    operation_key: { type: DataTypes.STRING(64), allowNull: false },
  },
  indexes: [
    { name: 'uq_ajustes_corrige', fields: ['corrige_id'], unique: true },
    { name: 'uq_ajustes_operation_key', fields: ['operation_key'], unique: true },
    { name: 'idx_ajustes_tarot', fields: ['tarot_id', 'data'] },
  ],
});
