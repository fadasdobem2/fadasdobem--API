'use strict';

/**
 * Porte das regras de período e de relógio da B: `features/shared/real-period.ts`, `shiftDateKey`,
 * `localOperationalDateKey` e `saoPauloTimestamp` (`features/domain/formatters.ts`).
 * Não duplica `_comum/dia-operacional.js` (que serve ao SQL); aqui ficam as funções de TEXTO usadas pela regra pura.
 */

/** Hora em que o dia operacional começa (`OPERATIONAL_DAY_START_HOUR` da B). */
const HORA_INICIO_DIA_OPERACIONAL = 6;
/** O maior período, contando as duas pontas. */
const MAX_DIAS_PERIODO = 366;

/** Soma `dias` a uma data AAAA-MM-DD (meio-dia UTC, sem virada de fuso). */
function deslocarData(chave, dias) {
  const [ano, mes, dia] = chave.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia + dias, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Dia operacional de um horário de parede de São Paulo (AAAA-MM-DDTHH:mm:ss), sem fuso envolvido. */
function chaveDiaOperacional(local, horaInicio = HORA_INICIO_DIA_OPERACIONAL) {
  if (!Number.isInteger(horaInicio) || horaInicio < 0 || horaInicio > 23) {
    throw new RangeError('Operational day start hour must be an integer from 0 to 23.');
  }
  const chave = local.slice(0, 10);
  return Number(local.slice(11, 13)) < horaInicio ? deslocarData(chave, -1) : chave;
}

const relogioSaoPaulo = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Relógio de parede de São Paulo, AAAA-MM-DDTHH:mm:ss. */
function carimboSaoPaulo(instante = new Date()) {
  return relogioSaoPaulo.format(instante).replace(' ', 'T');
}

/** Um dia de calendário que existe, AAAA-MM-DD: "2026-02-30" é recusado, não rolado. */
const diaReal = (dia) => /^\d{4}-\d{2}-\d{2}$/.test(dia) && deslocarData(dia, 0) === dia;

/** `end` não antes de `start`, e no máximo 366 dias contando as duas pontas. */
const periodoReal = ({ start, end }) => start <= end && end <= deslocarData(start, MAX_DIAS_PERIODO - 1);

module.exports = {
  HORA_INICIO_DIA_OPERACIONAL, MAX_DIAS_PERIODO, deslocarData, chaveDiaOperacional, carimboSaoPaulo, diaReal, periodoReal,
};
