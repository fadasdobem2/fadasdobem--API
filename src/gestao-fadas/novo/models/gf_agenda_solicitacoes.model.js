'use strict';

/** Banco novo (PostgreSQL da A): `gf_agenda_solicitacoes` (cliente quer consulta, pedida pela taróloga). Espelha a migração *gestao-fadas-painel*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfAgendaSolicitacoes',
  tabela: 'gf_agenda_solicitacoes',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_tarologo: { type: DataTypes.STRING(64), allowNull: false },
    id_cliente: { type: DataTypes.STRING(64), allowNull: false },
    data_operacional: { type: DataTypes.DATEONLY, allowNull: false },
    item: { type: DataTypes.JSONB, allowNull: false },
    version: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [{ name: 'gf_agenda_solicitacoes_tarologo', fields: ['id_tarologo', 'data_operacional'] }],
});
