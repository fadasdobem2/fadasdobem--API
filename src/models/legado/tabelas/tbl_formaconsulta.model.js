'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `tbl_formaconsulta` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoFormaConsulta extends Model {}

module.exports = (sequelize) => {
  LegadoFormaConsulta.init(
    {
      idFormaConsulta: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(11) NOT NULL AUTO_INCREMENT" },
      tpFormaConsulta: { type: DataTypes.STRING(10), allowNull: true, comment: "varchar(10) CHARACTER SET utf8 DEFAULT NULL" },
      dscFormaConsulta: { type: DataTypes.STRING(255), allowNull: true, comment: "varchar(255) CHARACTER SET utf8 DEFAULT NULL" },
      imagem_forma_consulta: { type: DataTypes.STRING(35), allowNull: true, comment: "varchar(35) COLLATE utf8_unicode_ci DEFAULT NULL" },
      title: { type: DataTypes.STRING(60), allowNull: true, comment: "varchar(60) COLLATE utf8_unicode_ci DEFAULT NULL" },
    },
    {
      sequelize,
      modelName: "LegadoFormaConsulta",
      tableName: "tbl_formaconsulta",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoFormaConsulta;
};

module.exports.NOME = "LegadoFormaConsulta";
module.exports.TABELA = "tbl_formaconsulta";
