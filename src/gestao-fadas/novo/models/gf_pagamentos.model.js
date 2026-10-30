'use strict';

/** Banco novo (PostgreSQL da A): `gf_pagamentos`. Espelha a migração *gestao-fadas-financeiro-cliente*. */

const { DataTypes, Op, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfPagamentos',
  tabela: 'gf_pagamentos',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_cliente: { type: DataTypes.STRING(10), allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false },
    confirmacao: { type: DataTypes.STRING(16), allowNull: true },
    valor_centavos: { type: DataTypes.BIGINT, allowNull: false },
    metodo: { type: DataTypes.STRING(24), allowNull: false },
    id_consulta: { type: DataTypes.STRING(64), allowNull: true },
    informado_em: { type: DataTypes.DATE, allowNull: false },
    item: { type: DataTypes.JSONB, allowNull: false },
    version: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [
    { name: 'gf_pagamentos_cliente', fields: ['id_cliente', 'informado_em'] },
    { name: 'gf_pagamentos_consulta', fields: ['id_consulta'], where: { id_consulta: { [Op.ne]: null } } },
  ],
});
