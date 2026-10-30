'use strict';

/** Instâncias do espelho genérico (`espelho-entidades.js`) para cada entidade com casa clara no legado. */

const { criar } = require('./espelho-entidades');
const clientes = require('./clientes');
const tarologos = require('./tarologos');
const { CAMPOS_CLIENTE, CAMPOS_TAROLOGO } = require('./fusao');

const objeto = (v) => (typeof v === 'string' ? JSON.parse(v) : v || {});
const inteiro = (v) => (/^[1-9]\d{0,9}$/.test(`${v}`) && Number(v) <= 2147483647 ? Number(v) : null);

const espelhoClientes = criar({
  entidade: 'clientes', rotulo: 'cliente', tabela: 'gf_clientes_ext', coluna: 'id_cliente', extras: 'dados', campos: CAMPOS_CLIENTE,
  idLegado: (row) => inteiro(row.id_cliente),
  traduzir: (row, pendentes) => clientes.linhaDoCliente(objeto(row.dados), pendentes),
  ler: clientes.ler, escrever: clientes.atualizar,
});

const espelhoTarologos = criar({
  entidade: 'tarologos', rotulo: 'tarólogo', tabela: 'gf_tarologos_perfil', coluna: 'tarot_id', extras: 'id_legado, nome, cadastro_ativo', campos: CAMPOS_TAROLOGO,
  filtroExtra: 'id_legado IS NOT NULL',
  idLegado: (row) => (row.id_legado === null || row.id_legado === undefined ? null : inteiro(row.id_legado)),
  traduzir: (row, pendentes) => tarologos.linhaDoTarologo({ nome: row.nome, cadastro_ativo: row.cadastro_ativo }, pendentes),
  ler: tarologos.ler, escrever: tarologos.atualizar,
});

module.exports = { clientes: espelhoClientes, tarologos: espelhoTarologos };
