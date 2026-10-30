'use strict';

/** Banco novo (PostgreSQL da A): `gf_agenda_eventos`. Espelha a migração *gestao-fadas-agenda*. */

const { DataTypes, literal } = require('sequelize');
const { definir, referencia } = require('./_definir');

module.exports = definir({
  nome: 'GfAgendaEventos',
  tabela: 'gf_agenda_eventos',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_agenda: referencia('gf_agenda', 'id', false),
    tipo: { type: DataTypes.STRING(20), allowNull: false },
    evento_ref: { type: DataTypes.STRING(160), allowNull: true },
    ator_id: { type: DataTypes.STRING(64), allowNull: false },
    ator_nome: { type: DataTypes.STRING(120), allowNull: false },
    ator_perfil: { type: DataTypes.STRING(20), allowNull: false },
    ocorrido_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    dados: { type: DataTypes.JSONB, allowNull: false },
    versao: { type: DataTypes.BIGINT, allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [
    { name: 'gf_agenda_eventos_agenda', fields: ['id_agenda', 'ocorrido_em'] },
    { name: 'uq_agenda_eventos_ref', fields: ['id_agenda', 'tipo', 'evento_ref'], unique: true, where: { evento_ref: { [require('sequelize').Op.ne]: null } } },
  ],
});
