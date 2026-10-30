'use strict';

/** Banco novo (PostgreSQL da A): `gf_agenda_ordem_comandos`. Espelha a migração *gestao-fadas-agenda*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfAgendaOrdemComandos',
  tabela: 'gf_agenda_ordem_comandos',
  atributos: {
    id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true },
    fila: { type: DataTypes.STRING(80), allowNull: false },
    base_revision: { type: DataTypes.STRING(80), allowNull: false },
    revisao_resultante: { type: DataTypes.STRING(80), allowNull: true },
    status: { type: DataTypes.STRING(12), allowNull: false },
    motivo: { type: DataTypes.STRING(12), allowNull: true },
    ator_id: { type: DataTypes.STRING(64), allowNull: false },
    ator_nome: { type: DataTypes.STRING(120), allowNull: false },
    ator_papel: { type: DataTypes.STRING(20), allowNull: false },
    moved_id: { type: DataTypes.STRING(64), allowNull: true },
    before_ids: { type: DataTypes.JSONB, allowNull: false },
    after_ids: { type: DataTypes.JSONB, allowNull: false },
    lineage: { type: DataTypes.JSONB, allowNull: true },
    ocorrido_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [{ name: 'gf_agenda_ordem_fila', fields: ['fila', 'ocorrido_em'] }],
});
