'use strict';

const { localOperationalDateKey, utcLocalToSaoPauloLocal } = require('./helpers/datas');
const { sumMoney } = require('./helpers/dinheiro');
const { paginate } = require('./helpers/paginacao');
const { legacyId, requireLegacyId, legacyLocalDateTime, legacyMoney, legacyText } = require('./helpers/valores-legado');

/**
 * Regra pura de RECEBIMENTOS (porte fiel de features/finance/real-receipts-model.ts e da parte de pagamentos de
 * features/integration/legacy-read-model.ts, do suspiro). Sem banco, sem relógio, sem float.
 *
 * Regra R5 (revista em 2026-10-26, D4): informado x confirmado x não localizado x conferir a origem. Os totais
 * confirmado e informado são SEPARADOS e nunca se somam; conferir a origem e não localizado ficam fora dos dois.
 * Os nomes do DTO (receipts, page, summary, tarologistPayouts...) são os do contrato da B e ficam idênticos.
 */

const INFORMED_TABLE = 'tbl_pagtoinformado';
const CONFIRMED_TABLE = 'tbl_pagtoconfirmado';
const NOT_FOUND_TABLE = 'tbl_pagtonaolocalizado';

/* ------------------------- leitura do legado (legacy-read-model.ts) ------------------------- */

function catalogValue(code, labels) {
  const id = code === null || code === undefined ? null : String(code);
  return { code: id, label: id === null ? null : (labels && labels.get(id)) ?? null };
}

/**
 * Identidade da origem é (tabela, id). IDs iguais não estabelecem deduplicação nem alocação.
 * `row.dt_criado` é TIMESTAMP lido em sessão com time_zone '+00:00' (R6): seu texto é UTC.
 * `catalogs`: { paymentOptions: Map código->rótulo, banks: Map código->rótulo }.
 */
function readLegacyPayment(row, table, catalogs = {}) {
  const id = requireLegacyId(row.idPagtoInformado, `${table}.idPagtoInformado`);
  const informedAtUtc = legacyLocalDateTime(row.dt_criado);
  const textStatus = legacyText(row.status);
  const numericStatus = row.id_status_pagto === null || row.id_status_pagto === undefined ? null : String(row.id_status_pagto);
  const normalized = textStatus === null ? undefined : textStatus.trim().toLocaleLowerCase('pt-BR');
  const confirmedEvidence = table === CONFIRMED_TABLE || numericStatus === '2' || normalized === 'confirmado';
  const blockedEvidence = table === NOT_FOUND_TABLE || normalized === 'bloqueado';
  return {
    origin: 'legacy',
    sourceTable: table,
    sourceId: id,
    sourceKey: `${table}:${id}`,
    readOnly: true,
    clientId: legacyId(row.idUsuario),
    clientIdentification: legacyText(row.nome_id),
    recordedAmount: legacyMoney(row.vlPagtoInformado),
    paidAtLocal: legacyLocalDateTime(row.dtPagtoInformado),
    informedAtLocal: informedAtUtc === null ? null : utcLocalToSaoPauloLocal(informedAtUtc),
    bank: catalogValue(row.idBanco, catalogs.banks),
    method: catalogValue(row.idFormaPagto, catalogs.paymentOptions),
    textStatus,
    numericStatus,
    confirmationEvidence: confirmedEvidence && blockedEvidence ? 'conflicting' : blockedEvidence ? 'blocked' : confirmedEvidence ? 'confirmed' : 'unverified',
    reconciliationRequired: true,
    canonicalPaymentId: null,
    linkedConsultationId: null,
  };
}

/** Rótulo da cliente a partir de usuarios.nome_id, senão "Cliente {id}"; nunca o nome civil. */
function legacyClientLabel(clientId, identification) {
  const label = (identification && identification.trim()) || null;
  return { clientLabel: label ?? (clientId ? `Cliente ${clientId}` : null), clientLabelMissing: label === null };
}

/* ------------------------------------ R5 (real-receipts-model.ts) ------------------------------------ */

/**
 * Tabela R5, revista em 2026-10-26 (D4): o que cada sinal de uma operação diz. Nenhum sinal tem precedência: a
 * situação sai da concordância dos sinais presentes. Uma cópia em tbl_pagtoconfirmado diz confirmado; texto vazio
 * não diz nada. Mudar esta tabela é decisão registrada da Laya.
 */
const NUMERIC_STATUS_SIGNALS = new Map([['2', 'confirmado'], ['1', 'informado'], ['0', 'informado']]);
const TEXT_STATUS_SIGNALS = new Map([['confirmado', 'confirmado'], ['informado', 'informado']]);

/** Uma linha de tbl_pagtoinformado, com ou sem o gêmeo em tbl_pagtoconfirmado. Valor desconhecido é nomeado primeiro. */
function informedReading(row, withTwin) {
  const number = NUMERIC_STATUS_SIGNALS.get(row.numericStatus ?? '');
  if (!number) return { situation: 'conferir-origem', reviewReason: 'numero-nao-previsto' };
  const text = (row.textStatus ?? '').trim().toLocaleLowerCase('pt-BR');
  const textSignal = TEXT_STATUS_SIGNALS.get(text);
  if (text !== '' && !textSignal) return { situation: 'conferir-origem', reviewReason: 'texto-nao-previsto' };
  const disagree = (textSignal !== undefined && textSignal !== number) || (withTwin && number !== 'confirmado');
  if (disagree) return { situation: 'conferir-origem', reviewReason: 'situacao-divergente' };
  return { situation: number, reviewReason: null };
}

const CONFIRMED = { situation: 'confirmado', reviewReason: null };
const NOT_FOUND = { situation: 'nao-localizado', reviewReason: null };
const TWIN_MISMATCH = { situation: 'conferir-origem', reviewReason: 'par-divergente' };

const ORIGIN_NAMES = {
  [INFORMED_TABLE]: 'Informado',
  [CONFIRMED_TABLE]: 'Confirmado',
  [NOT_FOUND_TABLE]: 'Não localizado',
};

/** Uma origem como a tela e a planilha a nomeiam: a palavra da tabela e a linha. */
const originName = (origin) => `${ORIGIN_NAMES[origin.table]} nº ${origin.id}`;

const paidDay = (row) => (row.paidAtLocal === null ? null : row.paidAtLocal.slice(0, 10));

/** Número, texto e lançamento só existem em tbl_pagtoinformado: ficam crus e nunca vêm de outra tabela (D8). */
function originOf(row) {
  const informed = row.sourceTable === INFORMED_TABLE;
  return {
    table: row.sourceTable,
    id: row.sourceId,
    numericStatus: informed ? row.numericStatus : null,
    textStatus: informed ? row.textStatus : null,
    launchedAtLocal: informed ? row.informedAtLocal : null,
  };
}

/** A linha principal dá os campos da operação; o gêmeo só entra como segunda origem. */
function receiptOf(main, reading, twin) {
  // O lançamento vem só do dt_criado da linha informada da própria operação, que é a principal de um par.
  const origin = originOf(main);
  const launchedAtLocal = origin.launchedAtLocal;
  return {
    key: main.sourceKey,
    origins: twin ? [origin, originOf(twin)] : [origin],
    clientId: main.clientId,
    ...legacyClientLabel(main.clientId, main.clientIdentification),
    paidOn: paidDay(main),
    launchedAtLocal,
    launchOperationalDate: launchedAtLocal === null ? null : localOperationalDateKey(launchedAtLocal),
    amount: main.recordedAmount,
    method: main.method,
    bank: main.bank,
    ...reading,
  };
}

function samePayment(a, b) {
  const day = paidDay(a);
  return a.clientId !== null && a.clientId === b.clientId
    && a.recordedAmount !== null && a.recordedAmount === b.recordedAmount
    && day !== null && day === paidDay(b);
}

/** Concilia as três fontes em operações antes de qualquer filtro de período (R5); Clientes concilia o histórico com isto (R20). */
function reconcileReceipts(input) {
  const confirmedById = new Map(input.confirmed.map((row) => [row.sourceId, row]));
  const informedById = new Map(input.informed.map((row) => [row.sourceId, row]));
  const receipts = [];
  for (const row of input.informed) {
    const twin = confirmedById.get(row.sourceId);
    if (!twin) receipts.push(receiptOf(row, informedReading(row, false)));
    else if (samePayment(row, twin)) receipts.push(receiptOf(row, informedReading(row, true), twin));
    else receipts.push(receiptOf(row, TWIN_MISMATCH));
  }
  for (const row of input.confirmed) {
    const twin = informedById.get(row.sourceId);
    if (!twin) receipts.push(receiptOf(row, CONFIRMED));
    else if (!samePayment(twin, row)) receipts.push(receiptOf(row, TWIN_MISMATCH));
  }
  for (const row of input.notFound) receipts.push(receiptOf(row, NOT_FOUND));
  return receipts;
}

const cmp = (a, b) => ((a ?? '') < (b ?? '') ? -1 : (a ?? '') > (b ?? '') ? 1 : 0);

function countSituations(items) {
  const counts = { confirmado: 0, informado: 0, 'nao-localizado': 0, 'conferir-origem': 0 };
  for (const item of items) counts[item.situation] += 1;
  return counts;
}

/** Totais e contagens de um conjunto de operações: confirmado e informado à parte, as outras situações em nenhum. */
function summarizeReceipts(items) {
  const totalOf = (situation) => sumMoney(items.map((item) => (item.situation === situation ? item.amount : null)));
  return { confirmedTotal: totalOf('confirmado'), informedTotal: totalOf('informado'), counts: countSituations(items) };
}

/** O recorte inteiro antes da página: as páginas da tela são fatias dele, e a exportação o leva inteiro (R23). */
function buildRealReceiptsCut(input) {
  const { range, by } = input;
  const inRange = (day) => day !== null && day >= range.start && day <= range.end;
  // Operação sem a data do filtro fica fora desse filtro, e sem data paga fora de todo período (D9). A mais recente
  // primeiro (decisão D5), com os mesmos desempates invertidos, para as páginas seguirem a tela.
  const selected = reconcileReceipts(input)
    .filter((item) => item.paidOn !== null && inRange(by === 'paid' ? item.paidOn : item.launchOperationalDate))
    .sort((a, b) => (by === 'paid' ? cmp(b.paidOn, a.paidOn) : 0) || cmp(b.launchedAtLocal, a.launchedAtLocal) || cmp(b.key, a.key));

  return {
    range: { start: range.start, end: range.end, by },
    receipts: selected,
    summary: summarizeReceipts(selected),
    tarologistPayouts: { integrated: false },
  };
}

function buildRealReceipts(input) {
  const cut = buildRealReceiptsCut(input);
  const paged = paginate(cut.receipts, input.page);
  return { range: cut.range, receipts: paged.items, page: paged.page, summary: cut.summary, tarologistPayouts: cut.tarologistPayouts };
}

const TABLE_ORDER = [INFORMED_TABLE, CONFIRMED_TABLE, NOT_FOUND_TABLE];

/**
 * Os recebimentos sem data paga (D9, R22), conciliados como nos períodos: um par precisa da data paga, então cada
 * linha é uma origem, por origem e chave. O leitor também traz os gêmeos por ID do outro lado, como o de período.
 */
function buildUndatedReceipts(input) {
  const undatedIds = (rows) => new Set(rows.filter((row) => paidDay(row) === null).map((row) => row.sourceId));
  const undatedInformed = undatedIds(input.informed);
  const undatedConfirmed = undatedIds(input.confirmed);
  const otherSide = (origin) => (origin.table === INFORMED_TABLE ? undatedConfirmed : origin.table === CONFIRMED_TABLE ? undatedInformed : null);
  const items = reconcileReceipts(input)
    .filter((item) => item.paidOn === null)
    .map((item) => {
      const other = otherSide(item.origins[0]);
      return {
        ...item,
        missing: { paidOn: true, launchedAt: item.launchedAtLocal === null },
        sameIdElsewhere: other ? other.has(item.origins[0].id) : false,
      };
    })
    .sort((a, b) => TABLE_ORDER.indexOf(a.origins[0].table) - TABLE_ORDER.indexOf(b.origins[0].table) || Number(a.origins[0].id) - Number(b.origins[0].id));
  const paged = paginate(items, input.page);
  return { receipts: paged.items, page: paged.page, counts: countSituations(items) };
}

module.exports = {
  INFORMED_TABLE,
  CONFIRMED_TABLE,
  NOT_FOUND_TABLE,
  readLegacyPayment,
  legacyClientLabel,
  originName,
  reconcileReceipts,
  summarizeReceipts,
  buildRealReceiptsCut,
  buildRealReceipts,
  buildUndatedReceipts,
};
