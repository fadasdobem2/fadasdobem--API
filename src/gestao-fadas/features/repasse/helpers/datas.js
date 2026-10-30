'use strict';

/**
 * Datas civis e instantes locais de São Paulo como TEXTO (sem fuso), como na B (`domain/formatters.ts`).
 * Dia operacional: 06:00 a 06:00. Não depende de `_comum/dia-operacional.js` porque a B precisa aqui do dia
 * operacional de um INSTANTE LOCAL em texto e de `shiftDateKey`.
 */

const OPERATIONAL_DAY_START_HOUR = 6;

function shiftDateKey(dateKey, dias) {
  const [ano, mes, dia] = dateKey.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia + dias, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Dia operacional de um texto de relógio de parede (AAAA-MM-DDTHH:mm:ss), sem fuso. */
function localOperationalDateKey(local, startHour = OPERATIONAL_DAY_START_HOUR) {
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
    throw new RangeError('A hora de início do dia operacional deve ser um inteiro de 0 a 23.');
  }
  const dateKey = local.slice(0, 10);
  return Number(local.slice(11, 13)) < startHour ? shiftDateKey(dateKey, -1) : dateKey;
}

/** Dia civil que existe, AAAA-MM-DD: "2026-02-30" é recusado, não rolado. */
function isRealDay(dia) {
  return typeof dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dia) && shiftDateKey(dia, 0) === dia;
}

/** Data da agenda (mesma regra do `isAgendaDate` da B). */
function isAgendaDate(valor) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) && Number.isFinite(Date.parse(`${valor}T12:00:00Z`))
    && new Date(`${valor}T12:00:00Z`).toISOString().slice(0, 10) === valor;
}

const RELOGIO_SP = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Relógio de parede de São Paulo de um instante, AAAA-MM-DDTHH:mm:ss. */
function saoPauloTimestamp(em = new Date()) {
  return RELOGIO_SP.format(em).replace(' ', 'T');
}

function dateKeyLabel(dateKey) {
  const [ano, mes, dia] = dateKey.split('-');
  return `${dia}/${mes}/${ano}`;
}

module.exports = {
  OPERATIONAL_DAY_START_HOUR, shiftDateKey, localOperationalDateKey, isRealDay, isAgendaDate, saoPauloTimestamp, dateKeyLabel,
};
