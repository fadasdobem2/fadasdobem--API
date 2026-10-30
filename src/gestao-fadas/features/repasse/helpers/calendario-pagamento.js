'use strict';

/**
 * Calendário de pagamento acordado (porta de `features/finance/tarologist-payment-schedule.ts`, B). Independe dos
 * turnos de atendimento. Só sábado/domingo ajustam; não há calendário de feriados bancários.
 */

const { isAgendaDate, shiftDateKey } = require('./datas');

const paymentWeekdays = [
  { value: 'segunda', label: 'Segunda-feira' }, { value: 'terca', label: 'Terça-feira' },
  { value: 'quarta', label: 'Quarta-feira' }, { value: 'quinta', label: 'Quinta-feira' },
  { value: 'sexta', label: 'Sexta-feira' },
];

function normalizePaymentSchedule(valor) {
  if (valor.kind === 'weekday') return paymentWeekdays.some((d) => d.value === valor.weekday) ? { kind: 'weekday', weekday: valor.weekday } : null;
  if (valor.kind !== 'monthdays' || !Array.isArray(valor.days) || !valor.days.length || valor.days.some((d) => !Number.isInteger(d) || d < 1 || d > 31)) return null;
  if (new Set(valor.days).size !== valor.days.length || (valor.weekendPolicy !== undefined && !['keep', 'next-business-day'].includes(valor.weekendPolicy))) return null;
  return { kind: 'monthdays', days: [...valor.days].sort((a, b) => a - b), ...(valor.weekendPolicy ? { weekendPolicy: valor.weekendPolicy } : {}) };
}

function paymentScheduleLabel(valor) {
  if (!valor) return 'Dia de pagamento a combinar';
  if (valor.kind === 'weekday') return `Pagamento: ${paymentWeekdays.find((d) => d.value === valor.weekday).label.toLocaleLowerCase('pt-BR')}`;
  const base = `Pagamento: ${valor.days.length === 1 ? 'dia' : 'dias'} ${valor.days.map((d) => String(d).padStart(2, '0')).join(' e ')} de cada mês`;
  return valor.weekendPolicy === 'next-business-day' ? `${base} · fim de semana: próxima segunda-feira` : base;
}

function adjustedPaymentDate(data, politica) {
  if (!isAgendaDate(data)) return null;
  if (politica !== 'next-business-day') return data;
  const diaSemana = new Date(`${data}T12:00:00Z`).getUTCDay();
  return diaSemana === 6 ? shiftDateKey(data, 2) : diaSemana === 0 ? shiftDateKey(data, 1) : data;
}

function paymentScheduledOnDate(valor, data) {
  if (!valor || !isAgendaDate(data)) return false;
  if (valor.kind === 'weekday') return ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'][new Date(`${data}T12:00:00Z`).getUTCDay()] === valor.weekday;
  // A data original pode pertencer ao mês/ano anterior. Duas ocorrências que chegam à mesma segunda geram um só pagamento.
  const olharAtras = valor.weekendPolicy === 'next-business-day' ? 2 : 0;
  for (let offset = 0; offset <= olharAtras; offset++) {
    const nominal = shiftDateKey(data, -offset);
    if (valor.days.includes(Number(nominal.slice(8, 10))) && adjustedPaymentDate(nominal, valor.weekendPolicy) === data) return true;
  }
  return false;
}

/** Dia mensal inexistente exige acordo; não pula a competência em silêncio (devolve null). */
function nextScheduledPayment(valor, hoje) {
  if (!valor || !normalizePaymentSchedule(valor) || !isAgendaDate(hoje)) return null;
  if (valor.kind === 'weekday') {
    for (let offset = 0; offset < 7; offset++) {
      const data = shiftDateKey(hoje, offset);
      if (paymentScheduledOnDate(valor, data)) return data;
    }
    return null;
  }
  const pendentes = [];
  if (valor.weekendPolicy === 'next-business-day') {
    for (let offset = 1; offset <= 2; offset++) {
      const nominal = shiftDateKey(hoje, -offset);
      if (!valor.days.includes(Number(nominal.slice(8, 10)))) continue;
      const efetiva = adjustedPaymentDate(nominal, valor.weekendPolicy);
      if (efetiva && efetiva >= hoje) pendentes.push(efetiva);
    }
  }
  const dias = [...valor.days].sort((a, b) => a - b);
  const dia = Number(hoje.slice(8, 10));
  const noMes = dias.find((c) => c >= dia);
  const mes = noMes !== undefined ? hoje.slice(0, 7) : new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 1)).toISOString().slice(0, 7);
  const nominal = `${mes}-${String(noMes ?? dias[0]).padStart(2, '0')}`;
  const efetiva = adjustedPaymentDate(nominal, valor.weekendPolicy);
  if (efetiva) pendentes.push(efetiva);
  return pendentes.sort()[0] ?? null;
}

module.exports = { paymentWeekdays, normalizePaymentSchedule, paymentScheduleLabel, adjustedPaymentDate, paymentScheduledOnDate, nextScheduledPayment };
