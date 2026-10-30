'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `cpf_status` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoCpfStatus extends Model {}

module.exports = (sequelize) => {
  LegadoCpfStatus.init(
    {
      idStatus: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, comment: "int(11) NOT NULL" },
      nomeStatus: { type: DataTypes.STRING(50), allowNull: true, comment: "varchar(50) CHARACTER SET utf8 DEFAULT NULL" },
      descricaoStatus: { type: DataTypes.STRING(255), allowNull: true, comment: "varchar(255) CHARACTER SET utf8 DEFAULT NULL" },
    },
    {
      sequelize,
      modelName: "LegadoCpfStatus",
      tableName: "cpf_status",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoCpfStatus;
};

module.exports.NOME = "LegadoCpfStatus";
module.exports.TABELA = "cpf_status";
