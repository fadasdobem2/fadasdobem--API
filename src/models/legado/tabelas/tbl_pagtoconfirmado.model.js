'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `tbl_pagtoconfirmado` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoPagamentoConfirmado extends Model {}

module.exports = (sequelize) => {
  LegadoPagamentoConfirmado.init(
    {
      idPagtoInformado: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(11) NOT NULL AUTO_INCREMENT" },
      idUsuario: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      dtPagtoInformado: { type: DataTypes.STRING(26), allowNull: false, comment: "DATETIME lido como texto (há valores zerados no legado) | datetime NOT NULL" },
      vlPagtoInformado: { type: DataTypes.DECIMAL(20,2), allowNull: true, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(20,2) DEFAULT '0.00'" },
      autPagtoInformado: { type: DataTypes.STRING(100), allowNull: false, comment: "varchar(100) CHARACTER SET utf8 NOT NULL" },
      idBanco: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      idFormaPagto: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      obsPagtoInformado: { type: DataTypes.TEXT, allowNull: false, comment: "text CHARACTER SET utf8 NOT NULL" },
      nmuAtendente: { type: DataTypes.STRING(25), allowNull: false, comment: "varchar(25) CHARACTER SET utf8 NOT NULL" },
    },
    {
      sequelize,
      modelName: "LegadoPagamentoConfirmado",
      tableName: "tbl_pagtoconfirmado",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoPagamentoConfirmado;
};

module.exports.NOME = "LegadoPagamentoConfirmado";
module.exports.TABELA = "tbl_pagtoconfirmado";
