'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/migrations-gf/001_repasses.sql. NÃO EDITAR À MÃO.
 * Tabela: `gf_repasse_divida_parcelas` (engine InnoDB).
 * Criada e gravada hoje pelo app do suspiro (Lucas). Fica somente leitura aqui até a API A assumir a escrita com decisão registrada.
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class GfRepasseDividaParcelas extends Model {}

module.exports = (sequelize) => {
  GfRepasseDividaParcelas.init(
    {
      divida_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true, comment: "VARCHAR(64) NOT NULL" },
      sequencia: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, comment: "INT NOT NULL" },
      data: { type: DataTypes.STRING(10), allowNull: false, comment: "DATE lido como texto (há valores zerados no legado) | DATE NOT NULL" },
      valor: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | DECIMAL(20,2) NOT NULL" },
    },
    {
      sequelize,
      modelName: "GfRepasseDividaParcelas",
      tableName: "gf_repasse_divida_parcelas",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return GfRepasseDividaParcelas;
};

module.exports.NOME = "GfRepasseDividaParcelas";
module.exports.TABELA = "gf_repasse_divida_parcelas";
