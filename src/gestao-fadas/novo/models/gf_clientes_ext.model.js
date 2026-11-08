'use strict';

/** Banco novo (PostgreSQL da A): `gf_clientes_ext`. Espelha a migração *gestao-fadas-cadastros*. */

const { DataTypes, literal } = require('sequelize');
const { definir } = require('./_definir');

module.exports = definir({
  nome: 'GfClientesExt',
  tabela: 'gf_clientes_ext',
  atributos: {
    id_cliente: { type: DataTypes.STRING(10), allowNull: false, primaryKey: true },
    perfil_pagamento: { type: DataTypes.STRING(10), allowNull: true },
    perfil_pagamento_em: { type: DataTypes.DATE, allowNull: true },
    dados: { type: DataTypes.JSONB, allowNull: false, defaultValue: literal("'{}'::jsonb") },
    revisao: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: literal('CURRENT_TIMESTAMP') },
    atualizado_por: { type: DataTypes.STRING(120), allowNull: false },
    operation_key: { type: DataTypes.STRING(128), allowNull: false },
    legado_estado: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'nao_espelhada' },
    legado_detalhe: { type: DataTypes.STRING(300), allowNull: true },
    legado_pendentes: { type: DataTypes.JSONB, allowNull: false, defaultValue: literal("'[]'::jsonb") },
    legado_atualizado_em: { type: DataTypes.DATE, allowNull: true },
    // Lilly v708 (migração 20261211000000): situação cadastral NULL | 'dados_pendentes' | 'completo' (NÃO é o perfil Pré/Pós) e "sem e-mail" declarado.
    situacao_cadastral: { type: DataTypes.STRING(20), allowNull: true },
    sem_email: { type: DataTypes.BOOLEAN, allowNull: true },
    // Dados da ficha (migração 20261213000000): nome completo, CPF, e-mail, telefones (lista do editor + índices) e endereço. NULL = sem complemento (vale o legado).
    nome_completo: { type: DataTypes.STRING(255), allowNull: true },
    cpf: { type: DataTypes.STRING(50), allowNull: true },
    email: { type: DataTypes.STRING(50), allowNull: true },
    telefones: { type: DataTypes.JSONB, allowNull: true },
    telefone_consulta_idx: { type: DataTypes.SMALLINT, allowNull: true },
    telefone_whatsapp_idx: { type: DataTypes.SMALLINT, allowNull: true },
    end_rua: { type: DataTypes.STRING(200), allowNull: true },
    end_numero: { type: DataTypes.STRING(20), allowNull: true },
    end_complemento: { type: DataTypes.STRING(100), allowNull: true },
    end_bairro: { type: DataTypes.STRING(100), allowNull: true },
    end_cep: { type: DataTypes.STRING(24), allowNull: true },
    end_cidade: { type: DataTypes.STRING(100), allowNull: true },
    end_uf: { type: DataTypes.STRING(100), allowNull: true },
    end_pais: { type: DataTypes.STRING(100), allowNull: true },
  },
});
