'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `bandeira_cartao` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoBandeiraCartao extends Model {}

module.exports = (sequelize) => {
  LegadoBandeiraCartao.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(10) unsigned NOT NULL AUTO_INCREMENT" },
      nome: { type: DataTypes.STRING(45), allowNull: false, comment: "varchar(45) NOT NULL" },
    },
    {
      sequelize,
      modelName: "LegadoBandeiraCartao",
      tableName: "bandeira_cartao",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoBandeiraCartao;
};

module.exports.NOME = "LegadoBandeiraCartao";
module.exports.TABELA = "bandeira_cartao";
