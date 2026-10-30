'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `obs_liberacao_consulta` (engine InnoDB).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoObsLiberacaoConsulta extends Model {}

module.exports = (sequelize) => {
  LegadoObsLiberacaoConsulta.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(11) unsigned NOT NULL AUTO_INCREMENT" },
      id_usuario: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      desc: { type: DataTypes.STRING(500), allowNull: false, comment: "varchar(500) COLLATE utf8_unicode_ci NOT NULL" },
      id_atendente: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      dt_hr: { type: DataTypes.STRING(26), allowNull: true, comment: "TIMESTAMP lido como texto (há valores zerados no legado) | timestamp NULL DEFAULT CURRENT_TIMESTAMP" },
    },
    {
      sequelize,
      modelName: "LegadoObsLiberacaoConsulta",
      tableName: "obs_liberacao_consulta",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoObsLiberacaoConsulta;
};

module.exports.NOME = "LegadoObsLiberacaoConsulta";
module.exports.TABELA = "obs_liberacao_consulta";
