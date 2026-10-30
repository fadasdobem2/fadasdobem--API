'use strict';

/** Banco novo (PostgreSQL da A): `gf_repasse_aberturas`. Espelha a migração *gestao-fadas-banco-novo*. */

const { DataTypes } = require('sequelize');
const { definir, TimestampSemFuso, usuario } = require('./_definir');

module.exports = definir({
  nome: 'GfRepasseAberturas',
  tabela: 'gf_repasse_aberturas',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    tarot_id: { type: DataTypes.STRING(16), allowNull: false },
    revisao: { type: DataTypes.INTEGER, allowNull: false },
    situacao: { type: DataTypes.STRING(12), allowNull: false },
    corrige_revisao: { type: DataTypes.INTEGER, allowNull: true },
    motivo_correcao: { type: DataTypes.STRING(500), allowNull: true },
    ultimo_pagamento_data: { type: DataTypes.DATEONLY, allowNull: false },
    ultimo_pagamento_valor: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
    planilha_referencia: { type: DataTypes.STRING(200), allowNull: false },
    quitado_ate: { type: TimestampSemFuso(), allowNull: false },
    saldo_remanescente: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
    saldo_composicao: { type: DataTypes.STRING(2000), allowNull: true },
    corte_migracao: { type: TimestampSemFuso(), allowNull: false },
    percentual_conferido: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 30 },
    lancado_por: usuario(),
    lancado_em: { type: DataTypes.BIGINT, allowNull: false },
    confirmado_por: usuario(true),
    confirmado_em: { type: DataTypes.BIGINT, allowNull: true },
    operation_key: { type: DataTypes.STRING(64), allowNull: false },
  },
  indexes: [
    { name: 'uq_aberturas_revisao', fields: ['tarot_id', 'revisao'], unique: true },
    { name: 'uq_aberturas_operation_key', fields: ['operation_key'], unique: true },
  ],
  // FK composta para a revisão corrigida (o Sequelize não a expressa em atributos); depois dos únicos acima.
  extras: [
    `ALTER TABLE gf_repasse_aberturas ADD CONSTRAINT fk_aberturas_corrige FOREIGN KEY (tarot_id, corrige_revisao)
      REFERENCES gf_repasse_aberturas (tarot_id, revisao) ON UPDATE RESTRICT ON DELETE RESTRICT`,
  ],
});
