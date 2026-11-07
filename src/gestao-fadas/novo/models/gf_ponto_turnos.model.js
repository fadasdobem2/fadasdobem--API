'use strict';

/** Banco novo (PostgreSQL da A): `gf_ponto_turnos`. Espelha a migração *gestao-fadas-ponto*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfPontoTurnos',
  tabela: 'gf_ponto_turnos',
  atributos: {
    id: { type: DataTypes.STRING(160), allowNull: false, primaryKey: true },
    id_conta: { type: DataTypes.STRING(160), allowNull: false },
    data_operacional: { type: DataTypes.DATEONLY, allowNull: false },
    iniciado_em: { type: DataTypes.DATE, allowNull: false },
    ultimo_em: { type: DataTypes.DATE, allowNull: false },
    conteudo: { type: DataTypes.JSONB, allowNull: false },
    revisao: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
  indexes: [
    { name: 'gf_ponto_turnos_conta_inicio', fields: ['id_conta', 'iniciado_em'] },
    { name: 'gf_ponto_turnos_dia', fields: ['data_operacional'] },
  ],
});
