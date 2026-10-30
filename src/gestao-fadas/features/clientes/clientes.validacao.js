'use strict';

/**
 * Validação das entradas HTTP de Clientes e os erros da API. Porta de features/clientes/real-clients-http.server.ts (os
 * esquemas zod LIST_QUERY, CONSULTATIONS_QUERY, RECEIPTS_QUERY, GRANT_ID) e de operationsError/parseQuery de
 * features/auth/real-access.server.ts. Aqui só o FORMATO é conferido, depois da permissão; a política de cada perfil
 * (recorte, busca, projeção, alcance) é a de clientes.model.js.
 *
 * Os nomes dos parâmetros são os da B (mode, start, end, page, pageSize, q, id, name, phone, email, birthDate, sort,
 * direction, grant, tarotId), porque o contrato (operations-http.md) é o que o front do suspiro consome.
 * Como parseQuery da B: parâmetro repetido é inválido; parâmetro desconhecido é ignorado.
 */

const AppError = require('../../../utils/AppError');
const { isRealDay, legacyId } = require('./helpers/valores');

const ERROS = {
  INVALID_INPUT: [400, 'Confira o período e a página e tente novamente.', 'Confira os dados informados e tente novamente.'],
  ACCESS_DENIED: [403, 'Esta informação não está disponível para a sua função.', 'Esta ação não está disponível para a sua função.'],
  CLIENT_NOT_FOUND: [404, 'Cadastro de cliente não encontrado.', 'Cadastro de cliente não encontrado.'],
};

/** Erro da API com o código e a mensagem da B (`write` escolhe o texto das escritas). */
function erro(codigo, write = false) {
  const [status, leitura, escrita] = ERROS[codigo];
  return new AppError(write ? escrita : leitura, status, { codigo });
}

const PAGE = (v) => (typeof v === 'string' && /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : undefined);
const DAY = (v) => (isRealDay(v) ? v : undefined);
const SEARCH = (v) => (typeof v === 'string' && v.length <= 200 ? v : undefined);
const GRANT_ID = (v) => (typeof v === 'string' && v.length >= 1 && v.length <= 64 ? v : undefined);
// Um ID do legado como o banco o escreve: "007" não acharia linha.
const LEGACY_ID = (v) => (typeof v === 'string' && /^[1-9]\d*$/.test(v) && legacyId(v) !== null ? v : undefined);
const ENUM = (...valores) => (v) => (typeof v === 'string' && valores.includes(v) ? v : undefined);
const PAGE_SIZE = (v) => (typeof v === 'string' && ['20', '30', '50'].includes(v) ? Number(v) : undefined);

const LISTA = {
  mode: ENUM('hoje', 'ontem', '7dias', 'data', 'periodo'),
  start: DAY,
  end: DAY,
  scope: ENUM('daily', 'live'),
  situation: ENUM('todos', 'consulta', 'nunca'),
  balance: ENUM('todos', 'credito', 'debito', 'zerado'),
  q: SEARCH,
  id: SEARCH,
  name: SEARCH,
  phone: SEARCH,
  email: SEARCH,
  birthDate: SEARCH,
  sort: ENUM('date', 'id', 'name', 'balance', 'lastConsultation', 'lastPayment'),
  direction: ENUM('asc', 'desc'),
  page: PAGE,
  pageSize: PAGE_SIZE,
};

// O histórico da ficha: páginas a partir da 1 (padrão 1), recorte de datas do filtro da v608 (Tudo por padrão) e `grant`.
const HISTORICO = {
  page: PAGE,
  q: SEARCH,
  direction: ENUM('asc', 'desc'),
  mode: ENUM('tudo', 'hoje', 'ontem', '7dias', 'data', 'periodo'),
  start: DAY,
  end: DAY,
  grant: GRANT_ID,
};
const CONSULTAS = { ...HISTORICO, sort: ENUM('recent', 'oldest', 'name', 'channel', 'duration', 'amount', 'status'), tarotId: LEGACY_ID };
const RECEBIMENTOS = { ...HISTORICO, sort: ENUM('recent', 'oldest', 'name', 'amount', 'status') };

/** Os parâmetros que o esquema nomeia, ou null quando a query é inválida (parseQuery da B). */
function lerQuery(bruta, esquema) {
  const query = bruta && typeof bruta === 'object' ? bruta : {};
  const dado = {};
  for (const [nome, validar] of Object.entries(esquema)) {
    if (!Object.prototype.hasOwnProperty.call(query, nome)) continue;
    const valor = query[nome];
    // Repetido (array) ou aninhado (objeto) é inválido: qual valer não é palpite que valha a pena.
    if (typeof valor !== 'string') return null;
    const lido = validar(valor);
    if (lido === undefined) return null;
    dado[nome] = lido;
  }
  return dado;
}

const consultaDaLista = (query) => lerQuery(query, LISTA);

/** Query do histórico com `page` padrão 1. */
function consultaDoHistorico(query, esquema) {
  const lida = lerQuery(query, esquema);
  return lida ? { ...lida, page: lida.page ?? 1 } : null;
}

/** ID da cliente no caminho, ou null quando não é um ID do legado. */
const idDaCliente = (valor) => LEGACY_ID(typeof valor === 'string' ? valor : undefined) ?? null;

module.exports = {
  CONSULTAS,
  RECEBIMENTOS,
  consultaDaLista,
  consultaDoHistorico,
  erro,
  idDaCliente,
  lerQuery,
};
