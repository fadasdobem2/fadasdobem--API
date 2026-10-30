'use strict';

/** Banco novo (PostgreSQL da A): `gf_consultas_ext`. Espelha a migração *gestao-fadas-consulta*. */

const { DataTypes, Op, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfConsultasExt',
  tabela: 'gf_consultas_ext',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_consulta_legado: { type: DataTypes.STRING(10), allowNull: true },
    legado_estado: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'nao_espelhada' },
    legado_detalhe: { type: DataTypes.STRING(300), allowNull: true },
    legado_atualizado_em: { type: DataTypes.DATE, allowNull: true },
    id_tarologo: { type: DataTypes.STRING(64), allowNull: false },
    id_cliente: { type: DataTypes.STRING(64), allowNull: false },
    id_agenda: { type: DataTypes.STRING(64), allowNull: true },
    consulta_origem_id: { type: DataTypes.STRING(64), allowNull: true },
    status: { type: DataTypes.STRING(32), allowNull: false },
    perfil_pagamento: { type: DataTypes.STRING(12), allowNull: true },
    canal: { type: DataTypes.STRING(24), allowNull: true },
    comissao_percentual: { type: DataTypes.DECIMAL(7, 4), allowNull: false },
    aguardando_inicio: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    iniciada_em: { type: DataTypes.DATE, allowNull: false },
    encerrada_em: { type: DataTypes.DATE, allowNull: true },
    tarologo_iniciou_em: { type: DataTypes.DATE, allowNull: true },
    duracao_segundos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    item: { type: DataTypes.JSONB, allowNull: false },
    version: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    criado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [
    { name: 'gf_consultas_ext_abertas_tarologo', fields: ['id_tarologo'], where: { status: 'Em curso' } },
    { name: 'gf_consultas_ext_abertas_cliente', fields: ['id_cliente'], where: { status: 'Em curso' } },
    { name: 'gf_consultas_ext_dia', fields: ['iniciada_em'] },
    { name: 'gf_consultas_ext_agenda', fields: ['id_agenda'], where: { id_agenda: { [Op.ne]: null } } },
    { name: 'uq_consultas_continuacao', fields: ['consulta_origem_id'], unique: true, where: { consulta_origem_id: { [Op.ne]: null }, status: { [Op.notIn]: ['Anulada', 'Erro', 'Devolvida', 'Não houve'] } } },
    { name: 'uq_consultas_legado', fields: ['id_consulta_legado'], unique: true, where: { id_consulta_legado: { [Op.ne]: null } } },
  ],
});
