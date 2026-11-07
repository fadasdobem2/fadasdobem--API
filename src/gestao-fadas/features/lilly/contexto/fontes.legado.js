'use strict';

/**
 * Leituras do LEGADO (MySQL, SOMENTE LEITURA) que o snapshot da Lilly usa. Só SELECT por models, só as colunas da lista branca: nunca `senha`,
 * `login`, CPF, e-mail, endereço nem nascimento. Cada função é trocável em teste (`fontes.js`); falha do legado sobe como erro (503 traduzido por
 * `_comum/legado`) e o montador do assunto vira `complete:false`, nunca lista vazia.
 */

const { Op, where, literal } = require('sequelize');
const { lendo } = require('../../../_comum/legado');

/** Colunas de `usuarios` lidas para identificar e achar a cliente por telefone. */
const COLUNAS_USUARIO = ['id', 'nome_id', 'nome2', 'nome', 'ddi', 'ddd', 'ddd_real', 'telresidencial', 'telcomercial', 'cel', 'cel2', 'whats'];
const COLUNAS_PAGAMENTO = ['idPagtoInformado', 'idUsuario', 'dtPagtoInformado', 'vlPagtoInformado', 'idBanco', 'idFormaPagto'];
const COLUNAS_INFORMADO = [...COLUNAS_PAGAMENTO, 'status', 'id_status_pagto', 'dt_criado'];

const ids = (lista) => [...new Set(lista)].map(Number).filter((n) => Number.isSafeInteger(n) && n >= 1 && n <= 2147483647);
const semMarcacao = (expressao) => `REGEXP_REPLACE(${expressao}, '[^0-9]', '')`;

/**
 * Pré-filtro "mais e nunca menos" (mesma forma do painel): os 8 últimos dígitos em cinco expressões, `nivel = 0`. Traz até `limite + 1`
 * linhas para o montador saber que passou do limite. `digitos8` já vem só com dígitos (nunca texto livre no SQL).
 */
function usuariosPorTelefone(digitos8, limite) {
  if (!/^\d{8}$/.test(digitos8)) return Promise.resolve([]);
  const como = (expressao) => where(literal(semMarcacao(expressao)), { [Op.like]: `%${digitos8}` });
  return lendo((m) => m.LegadoUsuario.findAll({
    attributes: COLUNAS_USUARIO,
    where: { [Op.and]: [{ nivel: 0 }, { [Op.or]: [
      como('CONCAT(ddd, telresidencial)'), como('CONCAT(ddd, telcomercial)'), como('CONCAT(ddd, cel COLLATE utf8_unicode_ci)'), como('CONCAT(ddd, cel2)'), como('whats'),
    ] }] },
    order: [['id', 'ASC']],
    limit: limite + 1,
    raw: true,
  }));
}

/** Cadastros (nivel 0) pelos IDs. Quem não existe simplesmente não volta. */
function usuariosPorIds(lista) {
  const alvo = ids(lista);
  if (!alvo.length) return Promise.resolve([]);
  return lendo((m) => m.LegadoUsuario.findAll({ attributes: COLUNAS_USUARIO, where: { nivel: 0, id: alvo }, order: [['id', 'ASC']], raw: true }));
}

/**
 * Pagamentos informados e confirmados das clientes desde `desdeLocal` (texto `AAAA-MM-DD HH:MM:SS`, relógio de São Paulo). Até `limite + 1`
 * por tabela. `tbl_pagtonaolocalizado` fica fora: não prova cliente (o `idUsuario` pode ser nulo).
 */
function pagamentosLegado(lista, desdeLocal, limite) {
  const alvo = ids(lista);
  if (!alvo.length) return Promise.resolve({ informed: [], confirmed: [] });
  const onde = { idUsuario: alvo, dtPagtoInformado: { [Op.gte]: desdeLocal } };
  return lendo(async (m) => ({
    informed: await m.LegadoPagamentoInformado.findAll({ attributes: COLUNAS_INFORMADO, where: onde, order: [['dtPagtoInformado', 'DESC'], ['idPagtoInformado', 'DESC']], limit: limite + 1, raw: true }),
    confirmed: await m.LegadoPagamentoConfirmado.findAll({ attributes: COLUNAS_PAGAMENTO, where: onde, order: [['dtPagtoInformado', 'DESC'], ['idPagtoInformado', 'DESC']], limit: limite + 1, raw: true }),
  }));
}

module.exports = { COLUNAS_USUARIO, usuariosPorTelefone, usuariosPorIds, pagamentosLegado };
