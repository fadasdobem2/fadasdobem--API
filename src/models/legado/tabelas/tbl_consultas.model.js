'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `tbl_consultas` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoConsulta extends Model {}

module.exports = (sequelize) => {
  LegadoConsulta.init(
    {
      idConsulta: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(11) NOT NULL AUTO_INCREMENT" },
      idUsuario: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL DEFAULT '0'" },
      dtConsulta: { type: DataTypes.STRING(26), allowNull: false, comment: "DATETIME lido como texto (há valores zerados no legado) | datetime NOT NULL" },
      iniConsulta: { type: DataTypes.STRING(26), allowNull: false, comment: "DATETIME lido como texto (há valores zerados no legado) | datetime NOT NULL" },
      fimConsulta: { type: DataTypes.STRING(26), allowNull: false, comment: "DATETIME lido como texto (há valores zerados no legado) | datetime NOT NULL" },
      tmpConsulta: { type: DataTypes.INTEGER, allowNull: true, comment: "int(8) DEFAULT NULL" },
      idTarologo: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      idFormaConsulta: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      idFormaPagto: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      obsConsulta: { type: DataTypes.TEXT, allowNull: false, comment: "text CHARACTER SET utf8 NOT NULL" },
      dtVencto: { type: DataTypes.STRING(26), allowNull: false, comment: "DATETIME lido como texto (há valores zerados no legado) | datetime NOT NULL" },
      vlDesconto: { type: DataTypes.INTEGER, allowNull: false, comment: "int(3) NOT NULL DEFAULT '0'" },
      vlBonus: { type: DataTypes.INTEGER, allowNull: false, comment: "int(3) NOT NULL DEFAULT '0'" },
      nmuAtendente: { type: DataTypes.STRING(25), allowNull: false, comment: "varchar(25) CHARACTER SET utf8 NOT NULL" },
      atendenteFinalizou: { type: DataTypes.STRING(25), allowNull: false, comment: "varchar(25) CHARACTER SET utf8 NOT NULL" },
      IDProdutoConsulta: { type: DataTypes.INTEGER, allowNull: true, comment: "int(11) DEFAULT '1'" },
      dtManutencao: { type: DataTypes.STRING(26), allowNull: true, comment: "TIMESTAMP lido como texto (há valores zerados no legado) | timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP" },
      abatimento: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(20,2) NOT NULL DEFAULT '0.00'" },
      vlPre: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(20,2) NOT NULL DEFAULT '0.00'" },
      saldo: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(20,2) NOT NULL DEFAULT '0.00'" },
      emailCobranca: { type: DataTypes.TINYINT, allowNull: false, comment: "tinyint(1) NOT NULL DEFAULT '0' COMMENT 'Foi enviado email de crobrança'" },
      valor_consulta: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(20,2) NOT NULL" },
      enviado: { type: DataTypes.INTEGER, allowNull: false, comment: "int(1) NOT NULL DEFAULT '0'" },
    },
    {
      sequelize,
      modelName: "LegadoConsulta",
      tableName: "tbl_consultas",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoConsulta;
};

module.exports.NOME = "LegadoConsulta";
module.exports.TABELA = "tbl_consultas";
