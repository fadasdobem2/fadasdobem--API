'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/migrations-gf/001_repasses.sql. NÃO EDITAR À MÃO.
 * Tabela: `gf_repasse_pagamentos` (engine InnoDB).
 * Criada e gravada hoje pelo app do suspiro (Lucas). Fica somente leitura aqui até a API A assumir a escrita com decisão registrada.
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class GfRepassePagamentos extends Model {}

module.exports = (sequelize) => {
  GfRepassePagamentos.init(
    {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true, comment: "VARCHAR(64) NOT NULL" },
      tarot_id: { type: DataTypes.STRING(16), allowNull: false, comment: "VARCHAR(16) NOT NULL" },
      valor: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | DECIMAL(20,2) NOT NULL" },
      pago_em: { type: DataTypes.STRING(10), allowNull: false, comment: "DATE lido como texto (há valores zerados no legado) | DATE NOT NULL" },
      periodo_inicio: { type: DataTypes.STRING(10), allowNull: false, comment: "DATE lido como texto (há valores zerados no legado) | DATE NOT NULL" },
      periodo_fim: { type: DataTypes.STRING(10), allowNull: false, comment: "DATE lido como texto (há valores zerados no legado) | DATE NOT NULL" },
      saldo_na_data: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | DECIMAL(20,2) NOT NULL" },
      situacao: { type: DataTypes.STRING(12), allowNull: false, comment: "VARCHAR(12) NOT NULL" },
      corrige_id: { type: DataTypes.STRING(64), allowNull: true, comment: "VARCHAR(64) NULL DEFAULT NULL" },
      motivo_correcao: { type: DataTypes.STRING(500), allowNull: true, comment: "VARCHAR(500) NULL DEFAULT NULL" },
      observacao: { type: DataTypes.STRING(500), allowNull: true, comment: "VARCHAR(500) NULL DEFAULT NULL" },
      registrado_por: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
      registrado_em: { type: DataTypes.BIGINT, allowNull: false, comment: "BIGINT volta como string | BIGINT NOT NULL" },
      operation_key: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
    },
    {
      sequelize,
      modelName: "GfRepassePagamentos",
      tableName: "gf_repasse_pagamentos",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return GfRepassePagamentos;
};

module.exports.NOME = "GfRepassePagamentos";
module.exports.TABELA = "gf_repasse_pagamentos";
