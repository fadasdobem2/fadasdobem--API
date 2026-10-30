'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/migrations-gf/001_repasses.sql. NÃO EDITAR À MÃO.
 * Tabela: `gf_repasse_cancelamentos` (engine InnoDB).
 * Criada e gravada hoje pelo app do suspiro (Lucas). Fica somente leitura aqui até a API A assumir a escrita com decisão registrada.
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class GfRepasseCancelamentos extends Model {}

module.exports = (sequelize) => {
  GfRepasseCancelamentos.init(
    {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true, comment: "VARCHAR(64) NOT NULL" },
      consulta_id: { type: DataTypes.STRING(16), allowNull: false, comment: "VARCHAR(16) NOT NULL" },
      tarot_id: { type: DataTypes.STRING(16), allowNull: false, comment: "VARCHAR(16) NOT NULL" },
      cliente_id: { type: DataTypes.STRING(16), allowNull: false, comment: "VARCHAR(16) NOT NULL" },
      queixa: { type: DataTypes.TEXT, allowNull: false, comment: "TEXT NOT NULL" },
      situacao: { type: DataTypes.STRING(10), allowNull: false, comment: "VARCHAR(10) NOT NULL" },
      motivo_decisao: { type: DataTypes.STRING(1000), allowNull: true, comment: "VARCHAR(1000) NULL DEFAULT NULL" },
      registrado_por: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
      registrado_em: { type: DataTypes.BIGINT, allowNull: false, comment: "BIGINT volta como string | BIGINT NOT NULL" },
      decidido_por: { type: DataTypes.STRING(64), allowNull: true, comment: "VARCHAR(64) NULL DEFAULT NULL" },
      decidido_em: { type: DataTypes.BIGINT, allowNull: true, comment: "BIGINT volta como string | BIGINT NULL DEFAULT NULL" },
      operation_key: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
    },
    {
      sequelize,
      modelName: "GfRepasseCancelamentos",
      tableName: "gf_repasse_cancelamentos",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return GfRepasseCancelamentos;
};

module.exports.NOME = "GfRepasseCancelamentos";
module.exports.TABELA = "gf_repasse_cancelamentos";
