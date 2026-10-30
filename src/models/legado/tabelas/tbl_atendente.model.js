'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `tbl_atendente` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoAtendente extends Model {}

module.exports = (sequelize) => {
  LegadoAtendente.init(
    {
      idAtendente: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(11) NOT NULL AUTO_INCREMENT" },
      muAtendente: { type: DataTypes.STRING(25), allowNull: true, comment: "varchar(25) CHARACTER SET utf8 DEFAULT NULL" },
      nmcAtendente: { type: DataTypes.STRING(75), allowNull: true, comment: "varchar(75) CHARACTER SET utf8 DEFAULT NULL" },
      sttAtendente: { type: DataTypes.TINYINT, allowNull: true, comment: "tinyint(4) DEFAULT '0'" },
    },
    {
      sequelize,
      modelName: "LegadoAtendente",
      tableName: "tbl_atendente",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoAtendente;
};

module.exports.NOME = "LegadoAtendente";
module.exports.TABELA = "tbl_atendente";
