'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/schema-catalog.json. NÃO EDITAR À MÃO.
 * Tabela: `status_pagamento` (engine InnoDB).
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class LegadoStatusPagamento extends Model {}

module.exports = (sequelize) => {
  LegadoStatusPagamento.init(
    {
      id_status_pagto: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, primaryKey: true, autoIncrement: true, comment: "int(10) unsigned NOT NULL AUTO_INCREMENT" },
      descricao: { type: DataTypes.STRING(15), allowNull: false, comment: "varchar(15) COLLATE utf8_unicode_ci NOT NULL" },
    },
    {
      sequelize,
      modelName: "LegadoStatusPagamento",
      tableName: "status_pagamento",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return LegadoStatusPagamento;
};

module.exports.NOME = "LegadoStatusPagamento";
module.exports.TABELA = "status_pagamento";
