'use strict';

/** Banco novo (PostgreSQL da A): `gf_ponto_eventos`. Espelha a migração *gestao-fadas-ponto*. Só acrescenta (gatilho). */

const { DataTypes } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfPontoEventos',
  tabela: 'gf_ponto_eventos',
  atributos: {
    id: { type: DataTypes.STRING(300), allowNull: false, primaryKey: true },
    id_conta: { type: DataTypes.STRING(160), allowNull: false },
    ocorreu_em: { type: DataTypes.DATE, allowNull: false },
    recebido_em: { type: DataTypes.DATE, allowNull: false },
    conteudo: { type: DataTypes.JSONB, allowNull: false },
  },
  indexes: [{ name: 'gf_ponto_eventos_conta_hora', fields: ['id_conta', 'ocorreu_em'] }],
});
