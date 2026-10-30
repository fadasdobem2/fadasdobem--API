'use strict';

/**
 * Porte de features/integration/legacy-values.ts (suspiro): decodificação pura dos valores do legado, sem SQL.
 * Só o que o recebimento usa.
 */

function legacyId(value) {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof text === 'string' && /^\d{1,10}$/.test(text) && Number(text) > 0 && Number(text) <= 2147483647 ? text : null;
}

function requireLegacyId(value, source) {
  const id = legacyId(value);
  if (!id) throw new Error(`Identificador inválido em ${source}; o registro não pode ser renumerado.`);
  return id;
}

/** DECIMAL(20,2) viaja como texto. Null não é zero; valores grandes nunca viram float. */
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

/** DATETIME do MySQL é relógio de parede. Não anexa o fuso de hoje a datas históricas. */
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

module.exports = { legacyId, requireLegacyId, legacyMoney, legacyLocalDateTime, legacyText };
