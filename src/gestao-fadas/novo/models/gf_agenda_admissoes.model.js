'use strict';

/** Banco novo (PostgreSQL da A): `gf_agenda_admissoes` (política de admissão do turno, só acrescenta). Espelha a migração *gestao-fadas-painel*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfAgendaAdmissoes',
  tabela: 'gf_agenda_admissoes',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_tarologo: { type: DataTypes.STRING(64), allowNull: false },
    data_operacional: { type: DataTypes.DATEONLY, allowNull: false },
    modo: { type: DataTypes.STRING(12), allowNull: false },
    ocorrido_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    item: { type: DataTypes.JSONB, allowNull: false },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [{ name: 'gf_agenda_admissoes_dia', fields: ['id_tarologo', 'data_operacional', 'ocorrido_em'] }],
});
