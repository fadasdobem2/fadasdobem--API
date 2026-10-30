'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `tbl_pagtoinformado` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoPagamentoInformado extends Model {}

module.exports = (sequelize) => {
  LegadoPagamentoInformado.init(
    {
      idPagtoInformado: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(11) NOT NULL AUTO_INCREMENT" },
      idUsuario: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      dtPagtoInformado: { type: DataTypes.STRING(26), allowNull: false, comment: "DATETIME lido como texto (há valores zerados no legado) | datetime NOT NULL" },
      vlPagtoInformado: { type: DataTypes.DECIMAL(20,2), allowNull: true, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(20,2) DEFAULT '0.00'" },
      autPagtoInformado: { type: DataTypes.STRING(100), allowNull: false, comment: "varchar(100) CHARACTER SET utf8 NOT NULL" },
      idBanco: { type: DataTypes.INTEGER, allowNull: true, comment: "int(11) DEFAULT NULL" },
      idFormaPagto: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      obsPagtoInformado: { type: DataTypes.TEXT, allowNull: false, comment: "text CHARACTER SET utf8 NOT NULL" },
      nmuAtendente: { type: DataTypes.STRING(25), allowNull: false, comment: "varchar(25) CHARACTER SET utf8 NOT NULL" },
      status: { type: DataTypes.STRING(250), allowNull: false, comment: "varchar(250) CHARACTER SET utf8 NOT NULL DEFAULT 'informado'" },
      dt_criado: { type: DataTypes.STRING(26), allowNull: false, comment: "TIMESTAMP lido como texto (há valores zerados no legado) | timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP" },
      id_status_pagto: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, comment: "int(10) unsigned NOT NULL" },
      id_bandeira_cartao: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, comment: "int(10) unsigned DEFAULT NULL" },
      parcelas: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, comment: "int(10) unsigned DEFAULT '1'" },
    },
    {
      sequelize,
      modelName: "LegadoPagamentoInformado",
      tableName: "tbl_pagtoinformado",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoPagamentoInformado;
};

module.exports.NOME = "LegadoPagamentoInformado";
module.exports.TABELA = "tbl_pagtoinformado";
