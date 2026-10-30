'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `tbl_opcaopagto` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoOpcaoPagamento extends Model {}

module.exports = (sequelize) => {
  LegadoOpcaoPagamento.init(
    {
      idOpcaoPagto: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(11) NOT NULL AUTO_INCREMENT" },
      tpOpcaoPagto: { type: DataTypes.STRING(25), allowNull: true, comment: "varchar(25) CHARACTER SET utf8 DEFAULT NULL" },
      dscOpcaoPagto: { type: DataTypes.STRING(50), allowNull: true, comment: "varchar(50) CHARACTER SET utf8 DEFAULT NULL" },
      imagem_forma_pagamento: { type: DataTypes.STRING(35), allowNull: true, comment: "varchar(35) COLLATE utf8_unicode_ci DEFAULT NULL" },
      title_forma_pagamento: { type: DataTypes.STRING(60), allowNull: true, comment: "varchar(60) COLLATE utf8_unicode_ci DEFAULT NULL" },
    },
    {
      sequelize,
      modelName: "LegadoOpcaoPagamento",
      tableName: "tbl_opcaopagto",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoOpcaoPagamento;
};

module.exports.NOME = "LegadoOpcaoPagamento";
module.exports.TABELA = "tbl_opcaopagto";
