'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/migrations-gf/001_repasses.sql. NÃO EDITAR À MÃO.
 * Tabela: `gf_repasse_calendarios` (engine InnoDB).
 * Criada e gravada hoje pelo app do suspiro (Lucas). Fica somente leitura aqui até a API A assumir a escrita com decisão registrada.
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class GfRepasseCalendarios extends Model {}

module.exports = (sequelize) => {
  GfRepasseCalendarios.init(
    {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true, comment: "VARCHAR(64) NOT NULL" },
      tarot_id: { type: DataTypes.STRING(16), allowNull: false, comment: "VARCHAR(16) NOT NULL" },
      tipo: { type: DataTypes.STRING(12), allowNull: false, comment: "VARCHAR(12) NOT NULL" },
      dia_semana: { type: DataTypes.STRING(8), allowNull: true, comment: "VARCHAR(8) NULL DEFAULT NULL" },
      dias_mes: { type: DataTypes.STRING(100), allowNull: true, comment: "VARCHAR(100) NULL DEFAULT NULL" },
      politica_fim_semana: { type: DataTypes.STRING(20), allowNull: true, comment: "VARCHAR(20) NULL DEFAULT NULL" },
      vigente_desde: { type: DataTypes.STRING(26), allowNull: false, comment: "DATETIME lido como texto (há valores zerados no legado) | DATETIME NOT NULL" },
      motivo: { type: DataTypes.STRING(500), allowNull: true, comment: "VARCHAR(500) NULL DEFAULT NULL" },
      registrado_por: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
      registrado_em: { type: DataTypes.BIGINT, allowNull: false, comment: "BIGINT volta como string | BIGINT NOT NULL" },
      operation_key: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
    },
    {
      sequelize,
      modelName: "GfRepasseCalendarios",
      tableName: "gf_repasse_calendarios",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return GfRepasseCalendarios;
};

module.exports.NOME = "GfRepasseCalendarios";
module.exports.TABELA = "gf_repasse_calendarios";
