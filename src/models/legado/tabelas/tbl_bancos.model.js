'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `tbl_bancos` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoBanco extends Model {}

module.exports = (sequelize) => {
  LegadoBanco.init(
    {
      idBanco: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(11) NOT NULL AUTO_INCREMENT" },
      nmBanco: { type: DataTypes.STRING(25), allowNull: true, comment: "varchar(25) CHARACTER SET utf8 DEFAULT NULL" },
      agBanco: { type: DataTypes.STRING(8), allowNull: true, comment: "varchar(8) CHARACTER SET utf8 DEFAULT NULL" },
      ccBanco: { type: DataTypes.STRING(12), allowNull: true, comment: "varchar(12) CHARACTER SET utf8 DEFAULT NULL" },
    },
    {
      sequelize,
      modelName: "LegadoBanco",
      tableName: "tbl_bancos",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoBanco;
};

module.exports.NOME = "LegadoBanco";
module.exports.TABELA = "tbl_bancos";
