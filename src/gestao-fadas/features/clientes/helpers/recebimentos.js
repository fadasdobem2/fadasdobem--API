'use strict';

/**
 * Leitura e conciliação de recebimentos reais (as três origens), como o Clientes precisa (R5, R20).
 * Porta de: features/integration/legacy-read-model.ts (readLegacyPayment) e features/finance/real-receipts-model.ts.
 * Cópia local de propósito: a feature `pagamentos` da A mantém as três listas separadas; a conciliação é da B.
 */

const { legacyId, legacyLocalDateTime, legacyMoney, legacyText, localOperationalDateKey, requireLegacyId, sumMoney, utcLocalToSaoPauloLocal } = require('./valores');
const { legacyClientLabel } = require('./consultas');

const INFORMED_TABLE = 'tbl_pagtoinformado';
const CONFIRMED_TABLE = 'tbl_pagtoconfirmado';
const NOT_FOUND_TABLE = 'tbl_pagtonaolocalizado';

function catalogValue(code, labels) {
  const id = code === null || code === undefined ? null : String(code);
  return { code: id, label: id === null ? null : (labels && labels[id]) ?? null };
}

/** Identidade da origem é (tabela, id). IDs iguais não provam deduplicação nem alocação. */
function readLegacyPayment(row, table, catalogs = {}) {
  const id = requireLegacyId(row.idPagtoInformado, `${table}.idPagtoInformado`);
  const informedAtUtc = legacyLocalDateTime(row.dt_criado);
  const textStatus = legacyText(row.status);
  const numericStatus = row.id_status_pagto === null || row.id_status_pagto === undefined ? null : String(row.id_status_pagto);
  const normalized = textStatus && textStatus.trim().toLocaleLowerCase('pt-BR');
  const confirmedEvidence = table === CONFIRMED_TABLE || numericStatus === '2' || normalized === 'confirmado';
  const blockedEvidence = table === NOT_FOUND_TABLE || normalized === 'bloqueado';
  return {
    origin: 'legacy', sourceTable: table, sourceId: id, sourceKey: `${table}:${id}`,
    readOnly: true, clientId: legacyId(row.idUsuario), clientIdentification: legacyText(row.nome_id), recordedAmount: legacyMoney(row.vlPagtoInformado),
    paidAtLocal: legacyLocalDateTime(row.dtPagtoInformado), informedAtLocal: informedAtUtc === null ? null : utcLocalToSaoPauloLocal(informedAtUtc),
    bank: catalogValue(row.idBanco, catalogs.banks), method: catalogValue(row.idFormaPagto, catalogs.paymentOptions),
    textStatus, numericStatus,
    confirmationEvidence: confirmedEvidence && blockedEvidence ? 'conflicting' : blockedEvidence ? 'blocked' : confirmedEvidence ? 'confirmed' : 'unverified',
    reconciliationRequired: true, canonicalPaymentId: null, linkedConsultationId: null,
  };
}

// Tabela R5 (revista em 2026-10-26, D4): o que cada sinal diz. Nenhum sinal tem precedência; a situação vem da concordância.
const NUMERIC_STATUS_SIGNALS = new Map([['2', 'confirmado'], ['1', 'informado'], ['0', 'informado']]);
const TEXT_STATUS_SIGNALS = new Map([['confirmado', 'confirmado'], ['informado', 'informado']]);

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

const paidDay = (row) => (row.paidAtLocal ? row.paidAtLocal.slice(0, 10) : null);

function originOf(row) {
  const informed = row.sourceTable === INFORMED_TABLE;
  return {
    table: row.sourceTable, id: row.sourceId, numericStatus: informed ? row.numericStatus : null,
    textStatus: informed ? row.textStatus : null, launchedAtLocal: informed ? row.informedAtLocal : null,
  };
}

function receiptOf(main, reading, twin) {
  const origin = originOf(main);
  const launchedAtLocal = origin.launchedAtLocal;
  return {
    key: main.sourceKey, origins: twin ? [origin, originOf(twin)] : [origin], clientId: main.clientId,
    ...legacyClientLabel(main.clientId, main.clientIdentification),
    paidOn: paidDay(main), launchedAtLocal,
    launchOperationalDate: launchedAtLocal === null ? null : localOperationalDateKey(launchedAtLocal),
    amount: main.recordedAmount, method: main.method, bank: main.bank, ...reading,
  };
}

function samePayment(a, b) {
  const day = paidDay(a);
  return a.clientId !== null && a.clientId === b.clientId
    && a.recordedAmount !== null && a.recordedAmount === b.recordedAmount
    && day !== null && day === paidDay(b);
}

/** Concilia as três fontes em operações, antes de qualquer filtro de período (R5). `input` = { informed, confirmed, notFound }. */
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

/** Totais e contagens: confirmado e informado à parte, as demais situações em nenhum dos dois. */
function summarizeReceipts(items) {
  const totalOf = (situation) => sumMoney(items.map((item) => (item.situation === situation ? item.amount : null)));
  return { confirmedTotal: totalOf('confirmado'), informedTotal: totalOf('informado'), counts: countSituations(items) };
}

/** O recorte inteiro de recebimentos. `input` = { informed, confirmed, notFound, range, by }. */
function buildRealReceiptsCut(input) {
  const { range, by } = input;
  const inRange = (day) => day !== null && day >= range.start && day <= range.end;
  const selected = reconcileReceipts(input)
    .filter((item) => item.paidOn !== null && inRange(by === 'paid' ? item.paidOn : item.launchOperationalDate))
    .sort((a, b) => (by === 'paid' ? cmp(b.paidOn, a.paidOn) : 0) || cmp(b.launchedAtLocal, a.launchedAtLocal) || cmp(b.key, a.key));
  return {
    range: { start: range.start, end: range.end, by }, receipts: selected, summary: summarizeReceipts(selected),
    tarologistPayouts: { integrated: false },
  };
}

module.exports = {
  CONFIRMED_TABLE, INFORMED_TABLE, NOT_FOUND_TABLE,
  buildRealReceiptsCut, originName, readLegacyPayment, reconcileReceipts, summarizeReceipts,
};
