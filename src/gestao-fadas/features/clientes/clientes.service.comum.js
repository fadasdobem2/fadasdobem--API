'use strict';

/** Constantes e utilitários de leitura em lote (fatia de clientes.service.js; leitura SOMENTE LEITURA do legado). */

const { Op } = require('sequelize');
const { saoPauloTimestamp, legacyLocalDateTime } = require('./helpers/valores');
const { INFORMED_TABLE, CONFIRMED_TABLE, NOT_FOUND_TABLE } = require('./helpers/recebimentos');
const { ANO_MINIMO_PAGAMENTO, diaSeguinte } = require('../../_comum/legado-datas');

/** Janela das datas pagas que valem (A4b): de 2000 até amanhã, no relógio de São Paulo; `civil` (opcional) a estreita ainda mais. */
function pagamentoValido(civil) {
  const de = `${ANO_MINIMO_PAGAMENTO}-01-01 00:00:00`;
  const ate = `${diaSeguinte(diaSeguinte(saoPauloTimestamp().slice(0, 10)))} 00:00:00`;
  const gte = civil && civil[Op.gte] > de ? civil[Op.gte] : de;
  const lt = civil && civil[Op.lt] < ate ? civil[Op.lt] : ate;
  return { [Op.gte]: gte, [Op.lt]: lt };
}

/** Colunas de `usuarios` que Clientes lê (R18), como database/legacy/read-clients.sql as nomeia. Sem senha, sem login. */
const COLUNAS_CLIENTE = [
  'id', 'nivel', 'nome_id', 'nome2', 'nome', 'ddd', 'telresidencial', 'telcomercial', 'cel', 'whats', 'email', 'email2',
  'cpf', 'status_cpf_id', 'buscaNaReceita', 'datanascimento', 'horanascimento', 'cidadeNascimento', 'ufNascimento',
  'IDpaisNascimento', 'endereco', 'numero', 'complemento', 'bairro', 'cep', 'cidade', 'estado', 'idPais', 'data_cadastro',
  'saldo', 'valorAPagar', 'id_cliente_valido',
];
/** Colunas de tbl_consultas lidas para a história (CONSULTATIONS_OF_CLIENTS): sem obsConsulta, atendente nem dtManutencao. */
const COLUNAS_CONSULTA = ['idConsulta', 'idUsuario', 'idTarologo', 'iniConsulta', 'fimConsulta', 'tmpConsulta', 'valor_consulta',
  'vlDesconto', 'vlBonus', 'abatimento', 'idFormaConsulta', 'idFormaPagto'];
const COLUNAS_PAGAMENTO = ['idPagtoInformado', 'idUsuario', 'dtPagtoInformado', 'vlPagtoInformado', 'idBanco', 'idFormaPagto'];
const COLUNAS_INFORMADO = [...COLUNAS_PAGAMENTO, 'status', 'id_status_pagto', 'dt_criado'];

const LOTE = 2000;

// --- utilitários -----------------------------------------------------------------------------------------

/**
 * IDs como números para `IN`, cada um uma vez. Só entram IDs legados válidos (inteiro de 1 a 2147483647): um `idUsuario`
 * nulo ou zerado (a documentação do legado avisa que `tbl_pagtonaolocalizado` aceita NULL) nunca é um cliente e, sem
 * este filtro, virava `NaN` no SQL.
 */
const numericIds = (ids) => [...new Set(ids)].map(Number).filter((n) => Number.isSafeInteger(n) && n >= 1 && n <= 2147483647);

async function emLotes(ids, leitor) {
  const unicos = numericIds(ids);
  const saida = [];
  for (let i = 0; i < unicos.length; i += LOTE) saida.push(...await leitor(unicos.slice(i, i + LOTE)));
  return saida;
}

const maior = (a, b) => (a === null || a === undefined ? b ?? null : b === null || b === undefined ? a : a >= b ? a : b);

function agregarMaximo(mapa, linhas, campo) {
  for (const linha of linhas) {
    const em = legacyLocalDateTime(linha[campo]);
    if (em === null) continue;
    if (linha.idUsuario === null || linha.idUsuario === undefined) continue; // sem cliente: não entra no mapa
    const id = String(linha.idUsuario);
    mapa.set(id, maior(mapa.get(id), em));
  }
}

function modelosDePagamento(m) {
  return { [INFORMED_TABLE]: m.LegadoPagamentoInformado, [CONFIRMED_TABLE]: m.LegadoPagamentoConfirmado, [NOT_FOUND_TABLE]: m.LegadoPagamentoNaoLocalizado };
}

module.exports = {
  COLUNAS_CLIENTE,
  COLUNAS_CONSULTA,
  COLUNAS_PAGAMENTO,
  COLUNAS_INFORMADO,
  LOTE,
  agregarMaximo,
  emLotes,
  maior,
  modelosDePagamento,
  numericIds,
  pagamentoValido,
};
