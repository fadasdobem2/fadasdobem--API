'use strict';

/** Banco novo (PostgreSQL da A): `gf_migracao_historicos`. Espelha a migração *gestao-fadas-migracao-planilha*. Só acrescenta. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfMigracaoHistoricos',
  tabela: 'gf_migracao_historicos',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_cliente: { type: DataTypes.STRING(10), allowNull: false },
    seq: { type: DataTypes.INTEGER, allowNull: false },
    source_key: { type: DataTypes.TEXT, allowNull: false },
    source_hash: { type: DataTypes.STRING(64), allowNull: false },
    batch_id: { type: DataTypes.STRING(160), allowNull: false },
    corte_em: { type: DataTypes.STRING(40), allowNull: false },
    credito_centavos: { type: DataTypes.BIGINT, allowNull: false },
    debito_centavos: { type: DataTypes.BIGINT, allowNull: false },
    cobrar_debito: { type: DataTypes.BOOLEAN, allowNull: false },
    pos_pago: { type: DataTypes.BOOLEAN, allowNull: false },
    aprovado_em: { type: DataTypes.DATE, allowNull: false },
    item: { type: DataTypes.JSONB, allowNull: false },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [
    { name: 'uq_migracao_historicos_seq', fields: ['id_cliente', 'seq'], unique: true },
    { name: 'uq_migracao_historicos_source', fields: ['id_cliente', 'source_hash'], unique: true },
    { name: 'gf_migracao_historicos_lote', fields: ['batch_id'] },
  ],
});
