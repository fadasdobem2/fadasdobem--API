'use strict';

/**
 * Domínio puro da escala da atendente (padrão semanal com vigência + exceções por data), porte versionado de
 * `features/atendimento/staff-roster-model.ts` do front da Nice (v702). Lista vazia de períodos = folga; sem entrada = sem escala definida.
 * Um período com fim menor que o início atravessa a meia-noite; o fim do dia anterior não pode passar do início do primeiro período do dia seguinte.
 * Sem banco, sem Express. Se o front mudar a regra, regerar os casos de `scripts/verificar-gf-ponto.js`.
 */

const { nextDate, timeMinutes, validDate } = require('./operacao-calendario');

const RELOGIO = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const objeto = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const validStaffDate = (d) => typeof d === 'string' && validDate(d);
const staffWeekday = (data) => String(new Date(`${data}T12:00:00Z`).getUTCDay());

function intervalo(p) {
  const de = timeMinutes(p.start); const fim = timeMinutes(p.end);
  return { from: de, until: fim > de ? fim : fim + 1440 };
}

function validPeriods(v) {
  if (!Array.isArray(v) || v.length > 12) return false;
  if (!v.every((p) => objeto(p) && typeof p.start === 'string' && RELOGIO.test(p.start) && typeof p.end === 'string' && RELOGIO.test(p.end) && p.start !== p.end)) return false;
  const ordenados = v.map(intervalo).sort((a, b) => a.from - b.from);
  return ordenados.every((p, i) => i === 0 || p.from >= ordenados[i - 1].until);
}

function habitualStaffPeriods(escala, data, diaSemana = staffWeekday(data)) {
  if (!escala) return undefined;
  const vigente = escala.weekly.filter((v) => v.from <= data && v.days[diaSemana] !== undefined).sort((a, b) => b.from.localeCompare(a.from))[0];
  return vigente && vigente.days[diaSemana];
}

function staffRosterForDate(escala, data) {
  const excecao = escala && escala.exceptions[data];
  return excecao !== undefined ? excecao : habitualStaffPeriods(escala, data);
}

function validStaffRoster(valor) {
  if (!objeto(valor) || !Array.isArray(valor.weekly) || !objeto(valor.exceptions)) return false;
  const datas = new Set();
  for (const mudanca of valor.weekly) {
    if (!objeto(mudanca) || !validStaffDate(mudanca.from) || datas.has(mudanca.from) || !objeto(mudanca.days)) return false;
    if (!Object.entries(mudanca.days).every(([chave, periodos]) => /^[0-6]$/.test(chave) && validPeriods(periodos))) return false;
    datas.add(mudanca.from);
  }
  for (const [data, periodos] of Object.entries(valor.exceptions)) if (!validStaffDate(data) || !validPeriods(periodos)) return false;
  // O padrão semanal pode mudar em qualquer vigência; confere os dois lados de cada vigência e de cada exceção.
  const limites = new Set();
  for (const data of datas) for (let desloc = -1; desloc < 7; desloc++) limites.add(nextDate(data, desloc));
  for (const data of Object.keys(valor.exceptions)) {
    limites.add(nextDate(data, -1)); limites.add(data); limites.add(nextDate(data, 7)); limites.add(nextDate(data, 6));
  }
  return [...limites].every((data) => {
    const hoje = staffRosterForDate(valor, data) || [];
    const amanha = staffRosterForDate(valor, nextDate(data, 1)) || [];
    const sobra = Math.max(0, ...hoje.map((p) => intervalo(p).until - 1440));
    return amanha.every((p) => timeMinutes(p.start) >= sobra);
  });
}

/** `editStaffRoster`: edita uma exceção por data (`periods: null` apaga) ou o padrão semanal de um dia da semana a partir de `date`. */
function editStaffRoster(atual, edicao) {
  if (!validStaffDate(edicao.date)) throw new Error('Informe uma data válida.');
  if (edicao.periods !== null && !validPeriods(edicao.periods)) throw new Error('Confira o início e o fim de cada período. Os horários precisam ser distintos e os períodos não podem se sobrepor.');
  const base = atual || { weekly: [], exceptions: {} };
  const periodos = edicao.periods ? edicao.periods.slice().sort((a, b) => a.start.localeCompare(b.start)) : undefined;
  let resultado;
  if (edicao.kind === 'exception') {
    const excecoes = { ...base.exceptions };
    if (periodos) excecoes[edicao.date] = periodos; else delete excecoes[edicao.date];
    resultado = { ...base, exceptions: excecoes };
  } else {
    const anterior = base.weekly.find((versao) => versao.from === edicao.date);
    const nova = { from: edicao.date, days: { ...(anterior && anterior.days), [edicao.weekday]: periodos } };
    resultado = { ...base, weekly: [...base.weekly.filter((versao) => versao !== anterior), nova].sort((a, b) => a.from.localeCompare(b.from)) };
  }
  if (!validStaffRoster(resultado)) throw new Error('Confira se o fim do turno coincide com outro período já agendado no dia seguinte.');
  return resultado;
}

function describeStaffPeriods(periodos) {
  if (!periodos) return 'Sem escala definida';
  if (!periodos.length) return 'Folga';
  return periodos.map((p) => `${p.start} às ${p.end}${p.end < p.start ? ' do dia seguinte' : ''}`).join(' · ');
}

module.exports = { validStaffDate, staffWeekday, validPeriods, habitualStaffPeriods, staffRosterForDate, validStaffRoster, editStaffRoster, describeStaffPeriods };
