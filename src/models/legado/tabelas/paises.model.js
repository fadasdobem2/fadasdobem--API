'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `paises` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoPais extends Model {}

module.exports = (sequelize) => {
  LegadoPais.init(
    {
      Paises: { type: DataTypes.STRING(50), allowNull: true, comment: "varchar(50) CHARACTER SET utf8 DEFAULT NULL" },
      ID: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(11) NOT NULL AUTO_INCREMENT" },
    },
    {
      sequelize,
      modelName: "LegadoPais",
      tableName: "paises",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoPais;
};

module.exports.NOME = "LegadoPais";
module.exports.TABELA = "paises";
