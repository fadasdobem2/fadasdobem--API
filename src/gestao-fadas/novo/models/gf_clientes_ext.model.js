'use strict';

/** Banco novo (PostgreSQL da A): `gf_clientes_ext`. Espelha a migração *gestao-fadas-cadastros*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfClientesExt',
  tabela: 'gf_clientes_ext',
  atributos: {
    id_cliente: { type: DataTypes.STRING(10), allowNull: false, primaryKey: true },
    perfil_pagamento: { type: DataTypes.STRING(10), allowNull: true },
    perfil_pagamento_em: { type: DataTypes.DATE, allowNull: true },
    dados: { type: DataTypes.JSONB, allowNull: false, defaultValue: literal("'{}'::jsonb") },
    revisao: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
    legado_estado: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'nao_espelhada' },
    legado_detalhe: { type: DataTypes.STRING(300), allowNull: true },
    legado_pendentes: { type: DataTypes.JSONB, allowNull: false, defaultValue: literal("'[]'::jsonb") },
    legado_atualizado_em: { type: DataTypes.DATE, allowNull: true },
  },
});
