'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/migrations-gf/001_repasses.sql. NÃO EDITAR À MÃO.
 * Tabela: `gf_auditoria` (engine InnoDB).
 * Criada e gravada hoje pelo app do suspiro (Lucas). Fica somente leitura aqui até a API A assumir a escrita com decisão registrada.
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class GfAuditoria extends Model {}

module.exports = (sequelize) => {
  GfAuditoria.init(
    {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true, comment: "VARCHAR(64) NOT NULL" },
      ocorrido_em: { type: DataTypes.BIGINT, allowNull: false, comment: "BIGINT volta como string | BIGINT NOT NULL" },
      ator_conta_id: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
      ator_funcao: { type: DataTypes.STRING(32), allowNull: false, comment: "VARCHAR(32) NOT NULL" },
      acao: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
      entidade: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
      entidade_id: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
      antes: { type: DataTypes.TEXT('long'), allowNull: true, comment: "LONGTEXT NULL DEFAULT NULL" },
      depois: { type: DataTypes.TEXT('long'), allowNull: true, comment: "LONGTEXT NULL DEFAULT NULL" },
      motivo: { type: DataTypes.STRING(1000), allowNull: true, comment: "VARCHAR(1000) NULL DEFAULT NULL" },
      operation_key: { type: DataTypes.STRING(64), allowNull: false, comment: "VARCHAR(64) NOT NULL" },
    },
    {
      sequelize,
      modelName: "GfAuditoria",
      tableName: "gf_auditoria",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return GfAuditoria;
};

module.exports.NOME = "GfAuditoria";
module.exports.TABELA = "gf_auditoria";
