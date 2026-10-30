'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `perfil_cliente` (engine InnoDB).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoPerfilCliente extends Model {}

module.exports = (sequelize) => {
  LegadoPerfilCliente.init(
    {
      id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(10) unsigned NOT NULL AUTO_INCREMENT" },
      nome: { type: DataTypes.STRING(50), allowNull: false, comment: "varchar(50) COLLATE utf8_unicode_ci NOT NULL" },
      consulta_autorizada: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, comment: "int(10) unsigned NOT NULL DEFAULT '1'" },
    },
    {
      sequelize,
      modelName: "LegadoPerfilCliente",
      tableName: "perfil_cliente",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoPerfilCliente;
};

module.exports.NOME = "LegadoPerfilCliente";
module.exports.TABELA = "perfil_cliente";
