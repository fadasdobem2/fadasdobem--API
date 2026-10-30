'use strict';

/** Banco novo (PostgreSQL da A): `gf_legado_verificacoes`. Espelha a migração *gestao-fadas-legado-verificacao* (Maturacao/53). */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfLegadoVerificacoes',
  tabela: 'gf_legado_verificacoes',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    intencao_id: { type: DataTypes.STRING(64), allowNull: false },
    entidade: { type: DataTypes.STRING(16), allowNull: false },
    entidade_id: { type: DataTypes.STRING(64), allowNull: false },
    legado_id: { type: DataTypes.STRING(20), allowNull: true },
    coluna: { type: DataTypes.STRING(24), allowNull: false },
    etapa: { type: DataTypes.SMALLINT, allowNull: false },
    vence_em: { type: DataTypes.DATE, allowNull: false },
    estado: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'pendente' },
    apos_reaplicacao: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    tentativas: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
    detalhe: { type: DataTypes.STRING(300), allowNull: true },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
  },
  indexes: [{ name: 'gf_legado_verificacoes_vence', fields: ['estado', 'vence_em'] }, { name: 'gf_legado_verificacoes_entidade', fields: ['entidade', 'entidade_id', 'coluna'] }],
});
