'use strict';

/** Banco novo (PostgreSQL da A): `gf_consultas_eventos`. Espelha a migração *gestao-fadas-consulta*. */

const { DataTypes, Op, literal } = require('sequelize');
const { definir, referencia } = require('./_definir');

module.exports = definir({
  nome: 'GfConsultasEventos',
  tabela: 'gf_consultas_eventos',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_consulta: referencia('gf_consultas_ext', 'id', false),
    tipo: { type: DataTypes.STRING(16), allowNull: false },
    evento_ref: { type: DataTypes.STRING(200), allowNull: true },
    ator_id: { type: DataTypes.STRING(64), allowNull: false },
    ator_nome: { type: DataTypes.STRING(120), allowNull: false },
    ator_perfil: { type: DataTypes.STRING(20), allowNull: false },
    ocorrido_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    dados: { type: DataTypes.JSONB, allowNull: false },
    versao: { type: DataTypes.BIGINT, allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [
    { name: 'gf_consultas_eventos_consulta', fields: ['id_consulta', 'ocorrido_em'] },
    { name: 'uq_consultas_eventos_ref', fields: ['id_consulta', 'tipo', 'evento_ref'], unique: true, where: { evento_ref: { [Op.ne]: null } } },
    { name: 'uq_consultas_termino', fields: ['id_consulta'], unique: true, where: { tipo: 'termino' } },
  ],
});
