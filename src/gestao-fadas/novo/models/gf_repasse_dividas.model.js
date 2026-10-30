'use strict';

/** Banco novo (PostgreSQL da A): `gf_repasse_dividas`. Espelha a migração *gestao-fadas-banco-novo*. */

const { DataTypes } = require('sequelize');
const { definir, usuario, referencia } = require('./_definir');

module.exports = definir({
  nome: 'GfRepasseDividas',
  tabela: 'gf_repasse_dividas',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    tarot_id: { type: DataTypes.STRING(16), allowNull: false },
    tipo: { type: DataTypes.STRING(8), allowNull: false },
    origem: { type: DataTypes.STRING(10), allowNull: false },
    abertura_id: referencia('gf_repasse_aberturas'),
    valor: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
    entrega_original: { type: DataTypes.DATEONLY, allowNull: true },
    entregue_em: { type: DataTypes.DATEONLY, allowNull: true },
    referencia_data: { type: DataTypes.DATEONLY, allowNull: true },
    situacao: { type: DataTypes.STRING(12), allowNull: false },
    corrige_id: referencia('gf_repasse_dividas'),
    motivo_correcao: { type: DataTypes.STRING(500), allowNull: true },
    planilha_referencia: { type: DataTypes.STRING(200), allowNull: true },
    observacao: { type: DataTypes.STRING(500), allowNull: true },
    registrado_por: usuario(),
    registrado_em: { type: DataTypes.BIGINT, allowNull: false },
    operation_key: { type: DataTypes.STRING(64), allowNull: false },
  },
  indexes: [
    { name: 'uq_dividas_corrige', fields: ['corrige_id'], unique: true },
    { name: 'uq_dividas_operation_key', fields: ['operation_key'], unique: true },
    { name: 'idx_dividas_tarot', fields: ['tarot_id'] },
  ],
});
