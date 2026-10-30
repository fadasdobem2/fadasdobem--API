'use strict';

/** Banco novo (PostgreSQL da A): `gf_repasse_pagamentos`. Espelha a migração *gestao-fadas-banco-novo*. */

const { DataTypes } = require('sequelize');
const { definir, usuario, referencia } = require('./_definir');

module.exports = definir({
  nome: 'GfRepassePagamentos',
  tabela: 'gf_repasse_pagamentos',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    tarot_id: { type: DataTypes.STRING(16), allowNull: false },
    valor: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
    pago_em: { type: DataTypes.DATEONLY, allowNull: false },
    periodo_inicio: { type: DataTypes.DATEONLY, allowNull: false },
    periodo_fim: { type: DataTypes.DATEONLY, allowNull: false },
    saldo_na_data: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
    situacao: { type: DataTypes.STRING(12), allowNull: false },
    corrige_id: referencia('gf_repasse_pagamentos'),
    motivo_correcao: { type: DataTypes.STRING(500), allowNull: true },
    observacao: { type: DataTypes.STRING(500), allowNull: true },
    registrado_por: usuario(),
    registrado_em: { type: DataTypes.BIGINT, allowNull: false },
    operation_key: { type: DataTypes.STRING(64), allowNull: false },
  },
  indexes: [
    { name: 'uq_pagamentos_corrige', fields: ['corrige_id'], unique: true },
    { name: 'uq_pagamentos_operation_key', fields: ['operation_key'], unique: true },
    { name: 'idx_pagamentos_tarot', fields: ['tarot_id', 'pago_em'] },
  ],
});
