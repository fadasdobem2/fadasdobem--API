'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `tbl_pagtoaberto` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoPagamentoAberto extends Model {}

module.exports = (sequelize) => {
  LegadoPagamentoAberto.init(
    {
      idPagto: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(100) NOT NULL AUTO_INCREMENT" },
      idUsuario: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      idConsulta: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      valor_consulta: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(20,2) NOT NULL" },
      obsPgto: { type: DataTypes.TEXT, allowNull: false, comment: "text COLLATE utf8_unicode_ci NOT NULL" },
    },
    {
      sequelize,
      modelName: "LegadoPagamentoAberto",
      tableName: "tbl_pagtoaberto",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoPagamentoAberto;
};

module.exports.NOME = "LegadoPagamentoAberto";
module.exports.TABELA = "tbl_pagtoaberto";
