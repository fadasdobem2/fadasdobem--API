'use strict';

/** Banco novo (PostgreSQL da A): `gf_recados_pessoais` (lido, fixado, prioridade e arquivado de cada conta). */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfRecadosPessoais',
  tabela: 'gf_recados_pessoais',
  atributos: {
    id_recado: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_conta: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    lido_em: { type: DataTypes.DATE, allowNull: true },
    lido_por: { type: DataTypes.STRING(200), allowNull: true },
    lido_versao: { type: DataTypes.TEXT, allowNull: true },
    fixado_em: { type: DataTypes.DATE, allowNull: true },
    prioridade_em: { type: DataTypes.DATE, allowNull: true },
    arquivado: { type: DataTypes.JSONB, allowNull: true },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [{ name: 'gf_recados_pessoais_conta', fields: ['id_conta'] }],
});
