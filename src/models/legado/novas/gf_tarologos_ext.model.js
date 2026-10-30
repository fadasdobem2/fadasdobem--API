'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/migrations-gf/001_tarologos_ext.sql. NÃO EDITAR À MÃO.
 * Tabela: `gf_tarologos_ext` (engine InnoDB).
 * Criada e gravada hoje pelo app do suspiro (Lucas). Fica somente leitura aqui até a API A assumir a escrita com decisão registrada.
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class GfTarologosExt extends Model {}

module.exports = (sequelize) => {
  GfTarologosExt.init(
    {
      id_tarologo: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, comment: "INT NOT NULL" },
      foto_atual_ref: { type: DataTypes.STRING(2048), allowNull: true, comment: "VARCHAR(2048) NULL DEFAULT NULL" },
      primeiro_nome_civil: { type: DataTypes.STRING(100), allowNull: true, comment: "VARCHAR(100) NULL DEFAULT NULL" },
      personal_whatsapp: { type: DataTypes.STRING(45), allowNull: true, comment: "VARCHAR(45) NULL DEFAULT NULL" },
      avatar_whatsapp: { type: DataTypes.STRING(45), allowNull: true, comment: "VARCHAR(45) NULL DEFAULT NULL" },
      situacao_turno: { type: DataTypes.STRING(20), allowNull: true, comment: "VARCHAR(20) NULL DEFAULT NULL" },
      retorno_previsto_em: { type: DataTypes.STRING(40), allowNull: true, comment: "VARCHAR(40) NULL DEFAULT NULL" },
    },
    {
      sequelize,
      modelName: "GfTarologosExt",
      tableName: "gf_tarologos_ext",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return GfTarologosExt;
};

module.exports.NOME = "GfTarologosExt";
module.exports.TABELA = "gf_tarologos_ext";
