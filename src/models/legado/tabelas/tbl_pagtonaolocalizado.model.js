'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `tbl_pagtonaolocalizado` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoPagamentoNaoLocalizado extends Model {}

module.exports = (sequelize) => {
  LegadoPagamentoNaoLocalizado.init(
    {
      idPagtoInformado: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(11) NOT NULL AUTO_INCREMENT" },
      idUsuario: { type: DataTypes.INTEGER, allowNull: true, comment: "int(11) DEFAULT NULL" },
      dtPagtoInformado: { type: DataTypes.STRING(26), allowNull: true, comment: "DATETIME lido como texto (há valores zerados no legado) | datetime DEFAULT NULL" },
      vlPagtoInformado: { type: DataTypes.DOUBLE, allowNull: true, comment: "ponto flutuante no legado; não usar para dinheiro | double DEFAULT '0'" },
      autPagtoInformado: { type: DataTypes.STRING(100), allowNull: true, comment: "varchar(100) CHARACTER SET utf8 DEFAULT NULL" },
      idBanco: { type: DataTypes.INTEGER, allowNull: true, comment: "int(11) DEFAULT NULL" },
      idFormaPagto: { type: DataTypes.INTEGER, allowNull: true, comment: "int(11) DEFAULT NULL" },
      obsPagtoInformado: { type: DataTypes.TEXT, allowNull: true, comment: "text CHARACTER SET utf8" },
      nmuAtendente: { type: DataTypes.STRING(25), allowNull: true, comment: "varchar(25) CHARACTER SET utf8 DEFAULT NULL" },
    },
    {
      sequelize,
      modelName: "LegadoPagamentoNaoLocalizado",
      tableName: "tbl_pagtonaolocalizado",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoPagamentoNaoLocalizado;
};

module.exports.NOME = "LegadoPagamentoNaoLocalizado";
module.exports.TABELA = "tbl_pagtonaolocalizado";
