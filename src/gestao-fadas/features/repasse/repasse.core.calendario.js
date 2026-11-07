'use strict';

/** Datas civis e data prevista de pagamento pelo calendário vigente. */

const { shiftDateKey } = require('./helpers/datas');
const { compareText } = require('./repasse.core.util');

function isCivilDate(texto) {
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) && shiftDateKey(texto, 0) === texto;
}
function civilDate(texto) {
  if (!isCivilDate(texto)) throw new Error(`Data inválida: ${texto}`);
  return texto;
}

// ---- Data prevista (calendário vigente) ----

const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

function weekdayOf(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Só sábado e domingo; não há calendário de feriados bancários, como no protótipo. */
function businessDay(date, policy) {
  if (policy !== 'next-business-day') return date;
  const weekday = weekdayOf(date);
  return weekday === 6 ? shiftDateKey(date, 2) : weekday === 0 ? shiftDateKey(date, 1) : date;
}

function nextMonth(date) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Próxima data do calendário maior ou igual a D, como o nextScheduledPayment da v584. Sem política gravada, a data fica.
 * Quando o próximo dia acordado não existe no mês (31/11, 29/02), a data fica sem valor e o caso sinalizado para
 * acordo, sem trocar pelo último dia do mês, pelo dia 1º nem pela ocorrência seguinte.
 */
function expectedPayment(schedule, date) {
  civilDate(date);
  if (schedule === null || schedule === undefined || schedule.kind === 'none') return { date: null, issue: null };
  if (schedule.kind === 'weekday') {
    const target = WEEKDAYS.indexOf(schedule.weekday);
    if (target < 0) throw new Error(`Dia da semana inválido: ${schedule.weekday}`);
    return { date: shiftDateKey(date, (target - weekdayOf(date) + 7) % 7), issue: null };
  }
  if (!schedule.days.length) throw new Error('Calendário por dias do mês sem nenhum dia.');
  const policy = schedule.weekendPolicy ?? 'keep';
  const days = [...schedule.days].sort((a, b) => a - b);
  const candidates = [];
  // Um dia acordado que caiu no fim de semana anterior ainda pode vencer hoje ou amanhã, mesmo vindo do mês anterior.
  if (policy === 'next-business-day') {
    for (const offset of [1, 2]) {
      const nominal = shiftDateKey(date, -offset);
      const effective = businessDay(nominal, policy);
      if (days.includes(Number(nominal.slice(8, 10))) && effective >= date) candidates.push(effective);
    }
  }
  const today = Number(date.slice(8, 10));
  const inMonth = days.find((dia) => dia >= today);
  const nominal = `${inMonth !== undefined ? date.slice(0, 7) : nextMonth(date)}-${String(inMonth ?? days[0]).padStart(2, '0')}`;
  const missing = !isCivilDate(nominal);
  if (!missing) candidates.push(businessDay(nominal, policy));
  candidates.sort(compareText);
  return candidates.length ? { date: candidates[0], issue: null } : { date: null, issue: missing ? 'missing-month-day' : null };
}

module.exports = { civilDate, expectedPayment };
