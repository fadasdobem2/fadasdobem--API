'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/migrations-gf/001_repasses.sql. NÃO EDITAR À MÃO.
 * Tabela: `gf_repasse_abertura_pendencias` (engine InnoDB).
 * Criada e gravada hoje pelo app do suspiro (Lucas). Fica somente leitura aqui até a API A assumir a escrita com decisão registrada.
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class GfRepasseAberturaPendencias extends Model {}

module.exports = (sequelize) => {
  GfRepasseAberturaPendencias.init(
    {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true, comment: "VARCHAR(64) NOT NULL" },
      abertura_id: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
      descricao: { type: DataTypes.STRING(500), allowNull: false, comment: "VARCHAR(500) NOT NULL" },
      valor: { type: DataTypes.DECIMAL(20,2), allowNull: true, comment: "DECIMAL volta como string (dinheiro nunca em float) | DECIMAL(20,2) NULL DEFAULT NULL" },
      resolvida_em: { type: DataTypes.BIGINT, allowNull: true, comment: "BIGINT volta como string | BIGINT NULL DEFAULT NULL" },
      resolvida_por: { type: DataTypes.STRING(64), allowNull: true, comment: "VARCHAR(64) NULL DEFAULT NULL" },
    },
    {
      sequelize,
      modelName: "GfRepasseAberturaPendencias",
      tableName: "gf_repasse_abertura_pendencias",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return GfRepasseAberturaPendencias;
};

module.exports.NOME = "GfRepasseAberturaPendencias";
module.exports.TABELA = "gf_repasse_abertura_pendencias";
