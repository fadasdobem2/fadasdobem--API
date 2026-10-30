'use strict';

/** Banco novo (PostgreSQL da A): `gf_repasse_pagamento_descontos`. Espelha a migração *gestao-fadas-banco-novo*. */

const { DataTypes } = require('sequelize');
const { definir, referencia } = require('./_definir');

module.exports = definir({
  nome: 'GfRepassePagamentoDescontos',
  tabela: 'gf_repasse_pagamento_descontos',
  atributos: {
    pagamento_id: { ...referencia('gf_repasse_pagamentos', 'id', false), primaryKey: true },
    divida_id: { ...referencia('gf_repasse_dividas', 'id', false), primaryKey: true },
    valor: { type: DataTypes.DECIMAL(20, 2), allowNull: false },
  },
});
