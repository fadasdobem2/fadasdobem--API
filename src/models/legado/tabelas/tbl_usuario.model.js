'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `tbl_usuario` (engine MyISAM).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 * Colunas deliberadamente fora do model (credenciais): senUsuario.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoUsuarioAsp extends Model {}

module.exports = (sequelize) => {
  LegadoUsuarioAsp.init(
    {
      IDUsuario: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(11) NOT NULL AUTO_INCREMENT" },
      nmcUsuario: { type: DataTypes.STRING(50), allowNull: true, comment: "varchar(50) CHARACTER SET utf8 DEFAULT NULL" },
      ysnAtivo: { type: DataTypes.TINYINT, allowNull: true, comment: "tinyint(4) DEFAULT '0'" },
    },
    {
      sequelize,
      modelName: "LegadoUsuarioAsp",
      tableName: "tbl_usuario",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoUsuarioAsp;
};

module.exports.NOME = "LegadoUsuarioAsp";
module.exports.TABELA = "tbl_usuario";
