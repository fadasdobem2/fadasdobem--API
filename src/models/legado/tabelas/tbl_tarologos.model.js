'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `tbl_tarologos` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 * Colunas deliberadamente fora do model (credenciais): pass.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoTarologo extends Model {}

module.exports = (sequelize) => {
  LegadoTarologo.init(
    {
      idTarologo: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(11) NOT NULL AUTO_INCREMENT" },
      ativo: { type: DataTypes.TINYINT, allowNull: false, comment: "tinyint(1) NOT NULL DEFAULT '1'" },
      nmuTarologo: { type: DataTypes.STRING(35), allowNull: true, comment: "varchar(35) CHARACTER SET utf8 DEFAULT NULL" },
      nmcTarologo: { type: DataTypes.STRING(100), allowNull: true, comment: "varchar(100) CHARACTER SET utf8 DEFAULT NULL" },
      vlCartao: { type: DataTypes.DECIMAL(3,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(3,2) NOT NULL DEFAULT '0.60'" },
      vlPgtoNormal: { type: DataTypes.DECIMAL(3,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | decimal(3,2) NOT NULL DEFAULT '0.60'" },
      Ramal: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL" },
      sexo: { type: DataTypes.STRING(1), allowNull: false, comment: "varchar(1) COLLATE utf8_unicode_ci NOT NULL DEFAULT 'a'" },
      oid: { type: DataTypes.INTEGER, allowNull: false, comment: "int(2) NOT NULL" },
      avatar: { type: DataTypes.STRING(35), allowNull: true, comment: "varchar(35) COLLATE utf8_unicode_ci DEFAULT NULL" },
      imagem_nome: { type: DataTypes.STRING(35), allowNull: true, comment: "varchar(35) COLLATE utf8_unicode_ci DEFAULT NULL" },
      desc_info: { type: DataTypes.TEXT, allowNull: true, comment: "text COLLATE utf8_unicode_ci" },
      bg_oraculos: { type: DataTypes.STRING(35), allowNull: true, comment: "varchar(35) COLLATE utf8_unicode_ci DEFAULT NULL" },
      exibir: { type: DataTypes.INTEGER, allowNull: false, comment: "int(11) NOT NULL DEFAULT '0'" },
      mural: { type: DataTypes.TEXT, allowNull: true, comment: "text COLLATE utf8_unicode_ci" },
      email: { type: DataTypes.STRING(100), allowNull: true, comment: "varchar(100) COLLATE utf8_unicode_ci DEFAULT NULL" },
      texto_oraculo: { type: DataTypes.TEXT, allowNull: true, comment: "text COLLATE utf8_unicode_ci" },
      meus_horarios: { type: DataTypes.TEXT, allowNull: true, comment: "text COLLATE utf8_unicode_ci" },
      desc_oraculos: { type: DataTypes.STRING(100), allowNull: true, comment: "varchar(100) COLLATE utf8_unicode_ci DEFAULT NULL" },
      mini_index: { type: DataTypes.STRING(100), allowNull: true, comment: "varchar(100) COLLATE utf8_unicode_ci DEFAULT NULL" },
      mini_interna: { type: DataTypes.STRING(100), allowNull: true, comment: "varchar(100) COLLATE utf8_unicode_ci DEFAULT NULL" },
      status: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, comment: "int(10) unsigned DEFAULT '1'" },
    },
    {
      sequelize,
      modelName: "LegadoTarologo",
      tableName: "tbl_tarologos",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoTarologo;
};

module.exports.NOME = "LegadoTarologo";
module.exports.TABELA = "tbl_tarologos";
