'use strict';

/**
 * Porte do que o recebimento usa de features/domain/formatters.ts e features/shared/real-period.ts (suspiro):
 * relógio de São Paulo, dia operacional (06h) e a regra do período (máximo 366 dias, contando as duas pontas).
 */

const OPERATIONAL_DAY_START_HOUR = 6;
const MAX_PERIOD_DAYS = 366;

const saoPauloWallClockFormatter = new Intl.DateTimeFormat('sv-SE', {
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
  return saoPauloWallClockFormatter.format(at).replace(' ', 'T');
}

function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

/** Dia operacional de um texto de relógio de São Paulo (AAAA-MM-DDTHH:mm:ss), sem fuso. */
function localOperationalDateKey(local, startHour = OPERATIONAL_DAY_START_HOUR) {
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
    throw new RangeError('Operational day start hour must be an integer from 0 to 23.');
  }
  const dateKey = local.slice(0, 10);
  return Number(local.slice(11, 13)) < startHour ? shiftDateKey(dateKey, -1) : dateKey;
}

/** Converte um texto de relógio UTC (TIMESTAMP lido em sessão UTC) para o relógio de São Paulo. */
function utcLocalToSaoPauloLocal(utcLocal) {
  return saoPauloTimestamp(new Date(`${utcLocal.slice(0, 19)}Z`));
}

/** Dia de calendário que existe, AAAA-MM-DD: "2026-02-30" é recusado, não rolado. */
function isRealDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && shiftDateKey(day, 0) === day;
}

/** `end` não antes de `start`, e no máximo 366 dias contando os dois. */
function withinRealPeriod({ start, end }) {
  return start <= end && end <= shiftDateKey(start, MAX_PERIOD_DAYS - 1);
}

module.exports = {
  OPERATIONAL_DAY_START_HOUR,
  MAX_PERIOD_DAYS,
  saoPauloTimestamp,
  shiftDateKey,
  localOperationalDateKey,
  utcLocalToSaoPauloLocal,
  isRealDay,
  withinRealPeriod,
};
