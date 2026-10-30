'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/migrations-gf/001_repasses.sql. NÃO EDITAR À MÃO.
 * Tabela: `gf_repasse_aberturas` (engine InnoDB).
 * Criada e gravada hoje pelo app do suspiro (Lucas). Fica somente leitura aqui até a API A assumir a escrita com decisão registrada.
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class GfRepasseAberturas extends Model {}

module.exports = (sequelize) => {
  GfRepasseAberturas.init(
    {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true, comment: "VARCHAR(64) NOT NULL" },
      tarot_id: { type: DataTypes.STRING(16), allowNull: false, comment: "VARCHAR(16) NOT NULL" },
      revisao: { type: DataTypes.INTEGER, allowNull: false, comment: "INT NOT NULL" },
      situacao: { type: DataTypes.STRING(12), allowNull: false, comment: "VARCHAR(12) NOT NULL" },
      corrige_revisao: { type: DataTypes.INTEGER, allowNull: true, comment: "INT NULL DEFAULT NULL" },
      motivo_correcao: { type: DataTypes.STRING(500), allowNull: true, comment: "VARCHAR(500) NULL DEFAULT NULL" },
      ultimo_pagamento_data: { type: DataTypes.STRING(10), allowNull: false, comment: "DATE lido como texto (há valores zerados no legado) | DATE NOT NULL" },
      ultimo_pagamento_valor: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | DECIMAL(20,2) NOT NULL" },
      planilha_referencia: { type: DataTypes.STRING(200), allowNull: false, comment: "VARCHAR(200) NOT NULL" },
      quitado_ate: { type: DataTypes.STRING(26), allowNull: false, comment: "DATETIME lido como texto (há valores zerados no legado) | DATETIME NOT NULL" },
      saldo_remanescente: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | DECIMAL(20,2) NOT NULL" },
      saldo_composicao: { type: DataTypes.STRING(2000), allowNull: true, comment: "VARCHAR(2000) NULL DEFAULT NULL" },
      corte_migracao: { type: DataTypes.STRING(26), allowNull: false, comment: "DATETIME lido como texto (há valores zerados no legado) | DATETIME NOT NULL" },
      percentual_conferido: { type: DataTypes.DECIMAL(5,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | DECIMAL(5,2) NOT NULL DEFAULT 30.00" },
      lancado_por: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
      lancado_em: { type: DataTypes.BIGINT, allowNull: false, comment: "BIGINT volta como string | BIGINT NOT NULL" },
      confirmado_por: { type: DataTypes.STRING(64), allowNull: true, comment: "VARCHAR(64) NULL DEFAULT NULL" },
      confirmado_em: { type: DataTypes.BIGINT, allowNull: true, comment: "BIGINT volta como string | BIGINT NULL DEFAULT NULL" },
      operation_key: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
    },
    {
      sequelize,
      modelName: "GfRepasseAberturas",
      tableName: "gf_repasse_aberturas",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return GfRepasseAberturas;
};

module.exports.NOME = "GfRepasseAberturas";
module.exports.TABELA = "gf_repasse_aberturas";
