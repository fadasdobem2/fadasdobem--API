'use strict';

/**
 * Dia operacional do Gestão Fadas: das 06:00 às 06:00, no fuso America/Sao_Paulo.
 * Fonte da regra: docs do suspiro (`OPERATIONAL_DAY_START_HOUR = 6`; `today` vem do relógio do servidor em São Paulo).
 * Os datetimes do legado são horários locais de São Paulo, sem fuso; por isso o intervalo é em texto, sem conversão.
 */

const HORA_INICIO = 6;

function somarDias(dataCivil, dias) {
  const d = new Date(`${dataCivil}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Dia operacional de um instante: antes das 06:00 ainda é o dia anterior. */
function hojeOperacional(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  const civil = `${p.year}-${p.month}-${p.day}`;
  return Number(p.hour) < HORA_INICIO ? somarDias(civil, -1) : civil;
}

/** Intervalo [inicio, fim) em texto para comparar com datetimes do legado. */
function intervaloDoDia(dataCivil) {
  const dois = (n) => String(n).padStart(2, '0');
  return { inicio: `${dataCivil} ${dois(HORA_INICIO)}:00:00`, fim: `${somarDias(dataCivil, 1)} ${dois(HORA_INICIO)}:00:00` };
}

/** Intervalo [inicio, fim) cobrindo de `de` até `ate` (datas civis, inclusive) em dias operacionais. */
function intervaloDoPeriodo(de, ate) {
  return { inicio: intervaloDoDia(de).inicio, fim: intervaloDoDia(ate).fim };
}

/* --- Equivalentes de `features/domain/formatters.ts` (B), acrescentados sem alterar o que já existia --- */

const RELOGIO_SP = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** `saoPauloTimestamp` da B: relógio de São Paulo de um instante, AAAA-MM-DDTHH:mm:ss. */
function timestampSaoPaulo(instante = new Date()) {
  return RELOGIO_SP.format(instante).replace(' ', 'T');
}

/** `localOperationalDateKey` da B: dia operacional de um texto de relógio de São Paulo, sem fuso. `hora` 0..23 (B: RangeError). */
function diaOperacionalDe(local, hora = HORA_INICIO) {
  if (!Number.isInteger(hora) || hora < 0 || hora > 23) {
    throw new RangeError('Operational day start hour must be an integer from 0 to 23.');
  }
  const dia = local.slice(0, 10);
  return Number(local.slice(11, 13)) < hora ? somarDias(dia, -1) : dia;
}

/** `dateKeyLabel` da B: AAAA-MM-DD -> DD/MM/AAAA. */
function rotuloData(dia) {
  const [ano, mes, d] = dia.split('-');
  return `${d}/${mes}/${ano}`;
}

module.exports = {
  HORA_INICIO, hojeOperacional, intervaloDoDia, intervaloDoPeriodo, somarDias,
  timestampSaoPaulo, diaOperacionalDe, rotuloData,
};
