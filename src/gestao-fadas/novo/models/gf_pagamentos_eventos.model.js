'use strict';

/** Banco novo (PostgreSQL da A): `gf_pagamentos_eventos`. Espelha a migração *gestao-fadas-financeiro-cliente*. */

const { DataTypes, literal } = require('sequelize');
const { definir, referencia } = require('./_definir');

module.exports = definir({
  nome: 'GfPagamentosEventos',
  tabela: 'gf_pagamentos_eventos',
  atributos: {
    id: { type: DataTypes.STRING(64), allowNull: false, primaryKey: true },
    id_pagamento: referencia('gf_pagamentos', 'id', false),
    tipo: { type: DataTypes.STRING(16), allowNull: false },
    ator_id: { type: DataTypes.STRING(64), allowNull: false },
    ator_nome: { type: DataTypes.STRING(120), allowNull: false },
    ator_perfil: { type: DataTypes.STRING(20), allowNull: false },
    ocorrido_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    dados: { type: DataTypes.JSONB, allowNull: false },
    versao: { type: DataTypes.BIGINT, allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
  },
  indexes: [{ name: 'gf_pagamentos_eventos_pagamento', fields: ['id_pagamento', 'ocorrido_em'] }],
});
