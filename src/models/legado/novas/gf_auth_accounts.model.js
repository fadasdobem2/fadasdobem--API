'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/migrations-gf/001_auth.sql. NÃO EDITAR À MÃO.
 * Tabela: `gf_auth_accounts` (engine InnoDB).
 * Criada e gravada hoje pelo app do suspiro (Lucas). Fica somente leitura aqui até a API A assumir a escrita com decisão registrada.
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 * Colunas deliberadamente fora do model (credenciais): password_hash, credential_version, bootstrap_key.
 */

const { Model, DataTypes } = require('sequelize');

class GfAuthAccounts extends Model {}

module.exports = (sequelize) => {
  GfAuthAccounts.init(
    {
      id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true, comment: "VARCHAR(64) NOT NULL" },
      display_name: { type: DataTypes.STRING(200), allowNull: false, comment: "VARCHAR(200) NOT NULL" },
      role: { type: DataTypes.STRING(32), allowNull: false, comment: "VARCHAR(32) NOT NULL" },
      active: { type: DataTypes.TINYINT, allowNull: false, comment: "TINYINT NOT NULL" },
      account_kind: { type: DataTypes.STRING(8), allowNull: false, comment: "VARCHAR(8) NOT NULL" },
      audience: { type: DataTypes.STRING(255), allowNull: false, comment: "VARCHAR(255) NOT NULL" },
      created_at: { type: DataTypes.BIGINT, allowNull: false, comment: "BIGINT volta como string | BIGINT NOT NULL" },
      updated_at: { type: DataTypes.BIGINT, allowNull: false, comment: "BIGINT volta como string | BIGINT NOT NULL" },
    },
    {
      sequelize,
      modelName: "GfAuthAccounts",
      tableName: "gf_auth_accounts",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return GfAuthAccounts;
};

module.exports.NOME = "GfAuthAccounts";
module.exports.TABELA = "gf_auth_accounts";
