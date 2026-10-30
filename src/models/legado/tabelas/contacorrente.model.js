'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `contacorrente` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoContaCorrente extends Model {}

module.exports = (sequelize) => {
  LegadoContaCorrente.init(
    {
      idMovimentacao: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(11) NOT NULL AUTO_INCREMENT" },
      idUsuario: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      dtMovimentacao: { type: DataTypes.STRING(26), allowNull: false, comment: "TIMESTAMP lido como texto (há valores zerados no legado) | timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP" },
      tpMovimentacao: { type: DataTypes.STRING(255), allowNull: false, comment: "varchar(255) COLLATE utf8_unicode_ci NOT NULL" },
      idPagto: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      idConsulta: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      vlMovimentacao: { type: DataTypes.DECIMAL(5,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(5,2) NOT NULL" },
    },
    {
      sequelize,
      modelName: "LegadoContaCorrente",
      tableName: "contacorrente",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoContaCorrente;
};

module.exports.NOME = "LegadoContaCorrente";
module.exports.TABELA = "contacorrente";
