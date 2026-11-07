'use strict';

/**
 * Horário de São Paulo no snapshot. O dia operacional vai das 06h às 06h (`_comum/dia-operacional`): um horário entre 00:00 e 05:59 do dia
 * operacional D acontece na madrugada de D+1. São Paulo está em UTC-03:00 o ano todo (sem horário de verão desde 2019); o offset é fixo.
 */

const { somarDias } = require('../../../_comum/dia-operacional');
const { HORA_INICIO_DO_DIA } = require('./contexto.base');

const dois = (n) => String(n).padStart(2, '0');
const partes = (hhmm) => { const m = `${hhmm}`.match(/^(\d{1,2}):(\d{2})/); return m ? [Number(m[1]), Number(m[2])] : null; };

/** `AAAA-MM-DDTHH:mm:00-03:00` do horário `hhmm` do dia operacional `dia`, ou `null` se o horário for inválido. */
function instanteOperacional(dia, hhmm) {
  const p = partes(hhmm);
  if (!p || p[0] > 23 || p[1] > 59) return null;
  const data = p[0] < HORA_INICIO_DO_DIA ? somarDias(dia, 1) : dia;
  return `${data}T${dois(p[0])}:${dois(p[1])}:00-03:00`;
}

/** Início e fim ISO de um período `inicio`-`fim` do dia operacional; fim menor ou igual ao início vira o dia seguinte (22h-00h, 22h-02h). */
function periodoOperacional(dia, inicio, fim) {
  const a = partes(inicio); const b = partes(fim);
  const startsAt = instanteOperacional(dia, inicio);
  if (!a || !b || !startsAt) return null;
  const dataInicio = startsAt.slice(0, 10);
  const dataFim = b[0] * 60 + b[1] <= a[0] * 60 + a[1] ? somarDias(dataInicio, 1) : dataInicio;
  if (b[0] > 23 || b[1] > 59) return null;
  return { startsAt, endsAt: `${dataFim}T${dois(b[0])}:${dois(b[1])}:00-03:00` };
}

const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const diaDaSemana = (dia) => DIAS_DA_SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()];

module.exports = { instanteOperacional, periodoOperacional, diaDaSemana, somarDias };
