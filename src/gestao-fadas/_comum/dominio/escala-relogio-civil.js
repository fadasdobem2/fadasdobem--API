'use strict';

/**
 * Relógio civil das escalas (v706 da Nice). Porte de `features/domain/schedule-civil-clock.ts`: escalas e agendamentos guardam dia da semana + relógio,
 * sem deslocamento de dia civil. A âncora das 06:00 é convenção de ARMAZENAMENTO, NÃO o corte configurável dos relatórios: mudar o corte do dia Fadas
 * nunca move um agendamento já marcado. Substitui, em `presenca-agenda.instantesDosPeriodos`, o `-03:00` fixo por São Paulo real (horário de verão
 * antes de 2019). Ouro: scripts/gerar-ouro-gf-prazos.js (históricos de verão). Puro.
 */

const { nextDate, saoPauloWallTimestamp, timeMinutes } = require('./operacao-calendario');

const LEGACY_SCHEDULE_DAY_START_MINUTES = 360;
const LEGACY_SCHEDULE_DAY_START = '06:00';

const minutosDoRelogioLegado = (relogio) => { const m = timeMinutes(relogio); return m < LEGACY_SCHEDULE_DAY_START_MINUTES ? m + 1440 : m; };
const dataCivilDoRelogioLegado = (data, relogio) => (timeMinutes(relogio) < LEGACY_SCHEDULE_DAY_START_MINUTES ? nextDate(data) : data);
const instanteDoRelogioLegado = (data, relogio) => saoPauloWallTimestamp(dataCivilDoRelogioLegado(data, relogio), relogio);

module.exports = { LEGACY_SCHEDULE_DAY_START_MINUTES, LEGACY_SCHEDULE_DAY_START, minutosDoRelogioLegado, dataCivilDoRelogioLegado, instanteDoRelogioLegado };
