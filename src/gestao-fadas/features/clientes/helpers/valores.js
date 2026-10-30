'use strict';

/**
 * Valores puros do legado e utilitários de data/paginação do Clientes.
 * Porta de: features/integration/legacy-values.ts, features/finance/money-cents.ts, features/shared/real-page.ts,
 * features/shared/real-period.ts e das funções de features/domain/formatters.ts que o Clientes usa.
 * Nada aqui executa SQL. Dinheiro é sempre texto/centavos (BigInt), nunca float.
 */

const AppError = require('../../../../utils/AppError');

const HORA_INICIO_DIA_OPERACIONAL = 6; // OPERATIONAL_DAY_START_HOUR da B (igual a _comum/dia-operacional.HORA_INICIO)
const ZERO = BigInt(0);
const CEM = BigInt(100);

// --- legacy-values ----------------------------------------------------------------------------------------

/** ID do legado como texto, ou null (inteiro positivo de até INT(11)). */
function legacyId(value) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === 'string' && /^\d{1,10}$/.test(text) && Number(text) > 0 && Number(text) <= 2147483647 ? text : null;
}

function requireLegacyId(value, source) {
  const id = legacyId(value);
  if (!id) throw new Error(`Identificador inválido em ${source}; o registro não pode ser renumerado.`);
  return id;
}

/** DECIMAL(20,2) viaja como texto. Null não é zero; nunca vira float. */
function legacyMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100)) return null;
  const match = String(value).match(/^(-?)(\d{1,18})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const integer = match[2].replace(/^0+(?=\d)/, '');
  const fraction = (match[3] || '').padEnd(2, '0');
  const sign = integer === '0' && fraction === '00' ? '' : match[1];
  return `${sign}${integer}.${fraction}`;
}

function legacyMinutes(value) {
  if (value === null || value === undefined || value === '' || !/^\d+$/.test(String(value))) return null;
  const minutes = Number(value);
  return Number.isSafeInteger(minutes) && minutes <= 2147483647 ? minutes : null;
}

/** DATETIME do MySQL é relógio local; não se anexa fuso a datas históricas. Zerada/inválida vira null. */
function legacyLocalDateTime(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = ''] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (y < 1000 || m < 1 || m > 12 || d < 1 || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (d > days[m - 1]) return null;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}`;
}

function legacyText(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Notas antigas podem ter HTML: a tela nova é texto puro; só <br> vira quebra de linha. */
function legacyNoteText(value) {
  return value ? value.replace(/<br\s*\/?\s*>/gi, '\n') : null;
}

// --- money-cents ------------------------------------------------------------------------------------------

function moneyToCents(text) {
  const match = text.match(/^(-?)(\d+)\.(\d{2})$/);
  if (!match) throw new Error(`Valor monetário inválido: ${text}`);
  const cents = BigInt(match[2]) * CEM + BigInt(match[3]);
  return match[1] ? -cents : cents;
}

function centsToMoney(cents) {
  const abs = cents < ZERO ? -cents : cents;
  const fraction = String(abs % CEM).padStart(2, '0');
  return `${cents < ZERO ? '-' : ''}${abs / CEM}.${fraction}`;
}

function sumCents(values) {
  return values.reduce((total, value) => (value === null ? total : total + moneyToCents(value)), ZERO);
}

function sumMoney(values) {
  return centsToMoney(sumCents(values));
}

// --- formatters (datas) -----------------------------------------------------------------------------------

const saoPauloWallClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Relógio de São Paulo de um instante, AAAA-MM-DDTHH:mm:ss. */
function saoPauloTimestamp(at = new Date()) {
  return saoPauloWallClock.format(at).replace(' ', 'T');
}

function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

/** Dia operacional de um relógio local (AAAA-MM-DDTHH:mm:ss): antes das 06h ainda é o dia anterior. */
function localOperationalDateKey(local, startHour = HORA_INICIO_DIA_OPERACIONAL) {
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
    throw new RangeError('Operational day start hour must be an integer from 0 to 23.');
  }
  const dateKey = local.slice(0, 10);
  return Number(local.slice(11, 13)) < startHour ? shiftDateKey(dateKey, -1) : dateKey;
}

/** TIMESTAMP lido em sessão UTC (R6) para o relógio de São Paulo. */
function utcLocalToSaoPauloLocal(utcLocal) {
  return saoPauloTimestamp(new Date(`${utcLocal.slice(0, 19)}Z`));
}

function resolveHistoryDateRange(mode, anchor, selectedDate, rangeStart, rangeEnd) {
  if (mode === 'ontem') {
    const yesterday = shiftDateKey(anchor, -1);
    return { start: yesterday, end: yesterday };
  }
  if (mode === '7dias') return { start: shiftDateKey(anchor, -6), end: anchor };
  if (mode === 'data') {
    const date = selectedDate || anchor;
    return { start: date, end: date };
  }
  if (mode === 'periodo') {
    const first = rangeStart || anchor;
    const last = rangeEnd || first;
    return first <= last ? { start: first, end: last } : { start: last, end: first };
  }
  return { start: anchor, end: anchor };
}

function normalizeSearch(value) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');
}

// --- real-period ------------------------------------------------------------------------------------------

const MAX_PERIOD_DAYS = 366;
/** Dia de calendário que existe, AAAA-MM-DD: "2026-02-30" é recusado, não arredondado. */
const isRealDay = (day) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && shiftDateKey(day, 0) === day;
const withinRealPeriod = ({ start, end }) => start <= end && end <= shiftDateKey(start, MAX_PERIOD_DAYS - 1);

// --- real-page --------------------------------------------------------------------------------------------

const REAL_PAGE_SIZE = 500;

/** Página além da última: a resposta HTTP é 400 (INVALID_INPUT na B). */
class PageOutOfRange extends AppError {
  constructor(page, totalPages) {
    super(`Página ${page} fora do intervalo; há ${totalPages} página(s).`, 400, { codigo: 'INVALID_INPUT' });
    this.name = 'PageOutOfRange';
  }
}

function pageSpan(info, shown) {
  const pages = Math.max(1, Math.ceil(info.totalItems / info.size));
  const from = (info.number - 1) * info.size + 1;
  return { pages, from, to: from + shown - 1 };
}

/** Números de uma página; a página 1 é sempre válida, mesmo sem itens. */
function pageInfo(page, size, totalItems) {
  const info = { number: page, size, totalItems };
  const { pages } = pageSpan(info, 0);
  if (!Number.isInteger(page) || page < 1 || page > pages) throw new PageOutOfRange(page, pages);
  return info;
}

function paginate(items, page, size = REAL_PAGE_SIZE) {
  const info = pageInfo(page, size, items.length);
  const from = (page - 1) * size;
  return { items: items.slice(from, from + size), page: info };
}

module.exports = {
  HORA_INICIO_DIA_OPERACIONAL,
  MAX_PERIOD_DAYS,
  PageOutOfRange,
  centsToMoney,
  isRealDay,
  legacyId,
  legacyLocalDateTime,
  legacyMinutes,
  legacyMoney,
  legacyNoteText,
  legacyText,
  localOperationalDateKey,
  moneyToCents,
  normalizeSearch,
  pageInfo,
  pageSpan,
  paginate,
  requireLegacyId,
  resolveHistoryDateRange,
  saoPauloTimestamp,
  shiftDateKey,
  sumCents,
  sumMoney,
  utcLocalToSaoPauloLocal,
  withinRealPeriod,
};
