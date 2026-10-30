'use strict';

/**
 * GERADO por scripts/gerar-models-legado.js a partir de gestao-fadas/fontes/migrations-gf/001_repasses.sql. NÃO EDITAR À MÃO.
 * Tabela: `gf_repasse_pagamento_descontos` (engine InnoDB).
 * Criada e gravada hoje pelo app do suspiro (Lucas). Fica somente leitura aqui até a API A assumir a escrita com decisão registrada.
 * SOMENTE LEITURA: o sistema ASP32 ainda grava nesta tabela; a API nunca a altera.
 */

const { Model, DataTypes } = require('sequelize');

class GfRepassePagamentoDescontos extends Model {}

module.exports = (sequelize) => {
  GfRepassePagamentoDescontos.init(
    {
      pagamento_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true, comment: "VARCHAR(64) NOT NULL" },
      divida_id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true, comment: "VARCHAR(64) NOT NULL" },
      valor: { type: DataTypes.DECIMAL(20,2), allowNull: false, comment: "DECIMAL volta como string (dinheiro nunca em float) | DECIMAL(20,2) NOT NULL" },
    },
    {
      sequelize,
      modelName: "GfRepassePagamentoDescontos",
      tableName: "gf_repasse_pagamento_descontos",
      freezeTableName: true,
      timestamps: false,
      underscored: false,
      somenteLeitura: true,
    }
  );
  return GfRepassePagamentoDescontos;
};

module.exports.NOME = "GfRepassePagamentoDescontos";
module.exports.TABELA = "gf_repasse_pagamento_descontos";
