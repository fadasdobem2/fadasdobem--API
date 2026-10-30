'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/migrations-gf/001_repasses.sql. NÃO EDITAR À MÃO.
 * Tabela: `gf_repasse_dividas` (engine InnoDB).
 * Criada e gravada hoje pelo app do suspiro (Lucas). Fica somente leitura aqui até a API A assumir a escrita com decisão registrada.
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class GfRepasseDividas extends Model {}

module.exports = (sequelize) => {
  GfRepasseDividas.init(
    {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true, comment: "VARCHAR(64) NOT NULL" },
      tarot_id: { type: DataTypes.STRING(16), allowNull: false, comment: "VARCHAR(16) NOT NULL" },
      tipo: { type: DataTypes.STRING(8), allowNull: false, comment: "VARCHAR(8) NOT NULL" },
      origem: { type: DataTypes.STRING(10), allowNull: false, comment: "VARCHAR(10) NOT NULL" },
      abertura_id: { type: DataTypes.STRING(64), allowNull: true, comment: "VARCHAR(64) NULL DEFAULT NULL" },
      valor: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | DECIMAL(20,2) NOT NULL" },
      entrega_original: { type: DataTypes.STRING(10), allowNull: true, comment: "DATE lido como texto (há valores zerados no legado) | DATE NULL DEFAULT NULL" },
      entregue_em: { type: DataTypes.STRING(10), allowNull: true, comment: "DATE lido como texto (há valores zerados no legado) | DATE NULL DEFAULT NULL" },
      referencia_data: { type: DataTypes.STRING(10), allowNull: true, comment: "DATE lido como texto (há valores zerados no legado) | DATE NULL DEFAULT NULL" },
      situacao: { type: DataTypes.STRING(12), allowNull: false, comment: "VARCHAR(12) NOT NULL" },
      corrige_id: { type: DataTypes.STRING(64), allowNull: true, comment: "VARCHAR(64) NULL DEFAULT NULL" },
      motivo_correcao: { type: DataTypes.STRING(500), allowNull: true, comment: "VARCHAR(500) NULL DEFAULT NULL" },
      planilha_referencia: { type: DataTypes.STRING(200), allowNull: true, comment: "VARCHAR(200) NULL DEFAULT NULL" },
      observacao: { type: DataTypes.STRING(500), allowNull: true, comment: "VARCHAR(500) NULL DEFAULT NULL" },
      registrado_por: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
      registrado_em: { type: DataTypes.BIGINT, allowNull: false, comment: "BIGINT volta como string | BIGINT NOT NULL" },
      operation_key: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
    },
    {
      sequelize,
      modelName: "GfRepasseDividas",
      tableName: "gf_repasse_dividas",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return GfRepasseDividas;
};

module.exports.NOME = "GfRepasseDividas";
module.exports.TABELA = "gf_repasse_dividas";
