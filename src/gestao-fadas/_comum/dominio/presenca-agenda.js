'use strict';

/**
 * Domínio puro da presença, parte 1: a escala efetiva do dia (porte versionado de `features/domain/professional-schedule.ts`,
 * `features/domain/schedule-overrides.ts` e dos trechos de `features/tarologas/tarologist-presence.ts` que a confirmação 60+5 usa).
 * Sem banco, sem Express. O servidor não tem o calendário de demonstração do front (`calendarNow` é o próprio relógio).
 * Se o front mudar a regra, regerar os casos de `scripts/verificar-gf-presenca.js`.
 */

const { somarDias, chaveDoDia, pertence } = require('./horarios');
const { diaOperacionalDe, timestampSaoPaulo } = require('../dia-operacional');
const RC = require('./escala-relogio-civil');
const { saoPauloWallTimestamp } = require('./operacao-calendario');

const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `saoPauloTimestampMillis` do front (formatters.ts:128): texto sem fuso é relógio de São Paulo. */
function milissegundos(valor) {
  if (!valor) return undefined;
  const comFuso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(valor) ? `${valor}-03:00` : valor;
  const em = Date.parse(comFuso);
  return Number.isFinite(em) ? em : undefined;
}

/** `saoPauloOperationalDateKey` do front para um instante em milissegundos. */
const diaOperacionalDoInstante = (ms) => diaOperacionalDe(timestampSaoPaulo(new Date(ms)));

const relogio = (ms) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));

/** `formatTimeValue`: "09:00" -> "9h", "09:30" -> "9h30". */
function formatarHora(valor) {
  const [h, m] = valor.split(':');
  return m === '00' ? `${Number(h)}h` : `${Number(h)}h${m}`;
}
const formatarPeriodos = (periodos) => periodos.map((p) => `${formatarHora(p.start)} às ${formatarHora(p.end)}`).join(' · ');

function periodosDoTexto(texto) {
  return [...String(texto).matchAll(/(\d{1,2})(?:(?:h|:)(\d{2})|h)?\s*(?:às|a|-)\s*(\d{1,2})(?:(?:h|:)(\d{2})|h)?/gi)]
    .map((m) => ({ start: `${m[1].padStart(2, '0')}:${m[2] || '00'}`, end: `${m[3].padStart(2, '0')}:${m[4] || '00'}` }));
}

/** `weeklyScheduleForDate` (formatters.ts, v706): a versão da escala habitual vigente na data (cadastro com vigência) vence a semana base. */
function semanaDaData(perfil, data) {
  const versao = [...(perfil.weeklyScheduleVersions || [])].filter((v) => v.effectiveFrom <= data).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return (versao && versao.schedule) || perfil.weeklySchedule || {};
}

/** `scheduleHoursForDate` (formatters.ts:151, com `weeklyScheduleForDate` da v706). */
function horasDaData(perfil, data) {
  return semanaDaData(perfil, data)[DIAS[new Date(`${data}T12:00:00Z`).getUTCDay()]] || 'Horário não informado';
}

/** `scheduleOverrideKeyOnDate`: o registro mais recente que cobre a data; empate fica com o específico do dia. */
function chaveDaExcecaoNaData(registros, tarotId, data) {
  const doDia = chaveDoDia(tarotId, data);
  const candidatas = Object.keys(registros).filter((c) => pertence(c, tarotId) && data >= registros[c].startDate && data <= registros[c].endDate).reverse();
  candidatas.sort((a, b) => {
    const e = milissegundos(registros[a].updatedAt); const d = milissegundos(registros[b].updatedAt);
    if (e !== undefined && d !== undefined && e !== d) return d - e;
    return Number(b === doDia) - Number(a === doDia);
  });
  return candidatas[0];
}
const excecaoNaData = (registros, tarotId, data) => { const c = chaveDaExcecaoNaData(registros, tarotId, data); return c ? registros[c] : undefined; };

function atualizacaoDoRetorno(perfil, relogioInicio) {
  const mudou = relogioInicio ? (perfil.presenceHistory || []).slice().reverse().find((e) => e.date === perfil.presenceDate
    && (e.after.includes(`Volta às ${relogioInicio}`) || e.after.includes(`Volta às ${formatarHora(relogioInicio)}`)
      || e.after.includes(`Volta no próximo turno, às ${formatarHora(relogioInicio)}`))) : undefined;
  return milissegundos(perfil.presenceScheduleUpdatedAt) ?? milissegundos(mudou && mudou.at);
}

/** `profileReturnSuperseded`: uma revisão posterior da programação substitui o aviso antigo de retorno. */
function retornoSubstituido(perfil, excecoes) {
  const data = (perfil.returnForecast && perfil.returnForecast.scheduleDate) ?? perfil.presenceDate;
  if (!data) return false;
  const ex = excecaoNaData(excecoes, perfil.id, data);
  const excecaoEm = milissegundos(ex && ex.updatedAt);
  const inicio = milissegundos(perfil.expectedReturn);
  const retornoEm = atualizacaoDoRetorno(perfil, inicio === undefined ? undefined : relogio(inicio));
  return excecaoEm !== undefined && retornoEm !== undefined && excecaoEm > retornoEm;
}

function escalaDaPresenca(perfil, data) {
  const previsao = perfil.returnForecast;
  const voltando = perfil.shiftExit === 'return' && (!previsao || ['exact', 'next-shift'].includes(previsao.kind))
    && ((previsao && previsao.scheduleDate) ?? perfil.presenceDate) === data;
  const confirmado = perfil.presenceConfirmedPeriod && perfil.presenceConfirmedPeriod.date === data ? perfil.presenceConfirmedPeriod : undefined;
  const ini = milissegundos(voltando ? perfil.expectedReturn : confirmado && confirmado.startAt);
  const fim = milissegundos(voltando ? perfil.returnUntil : confirmado && confirmado.endAt);
  if (ini === undefined || (!voltando && (fim === undefined || fim <= ini))) return undefined;
  const temFim = fim !== undefined && fim > ini;
  const periodos = temFim ? [{ start: relogio(ini), end: relogio(fim) }] : [];
  const relogioIni = relogio(ini);
  return {
    source: voltando ? 'return' : 'confirmed', periods: periodos, hours: temFim ? formatarPeriodos(periodos) : `A partir das ${formatarHora(relogioIni)}`, absent: false,
    updatedAt: atualizacaoDoRetorno(perfil, relogioIni), instants: temFim ? { startsAt: ini, endsAt: fim } : undefined,
  };
}

/** `professionalScheduleOnDate`: a declaração válida para a data vence a escala habitual, sem misturar os turnos. */
function escalaNaData(perfil, excecoes, data) {
  const ex = excecaoNaData(excecoes, perfil.id, data);
  const presenca = escalaDaPresenca(perfil, data);
  const excecaoEm = milissegundos(ex && ex.updatedAt);
  if (presenca && (!ex || presenca.updatedAt === undefined || excecaoEm === undefined || presenca.updatedAt >= excecaoEm)) return presenca;
  if (ex) {
    const ausente = ex.absenceType !== 'Nenhuma' || /folga|não atende|não vou atender/i.test(ex.todayHours);
    const periodos = ausente ? [] : ex.periods ?? periodosDoTexto(ex.todayHours);
    return { source: 'override', periods: periodos, hours: ausente ? (ex.absenceType !== 'Nenhuma' ? ex.absenceType : ex.todayHours) : periodos.length ? formatarPeriodos(periodos) : ex.todayHours, absent: ausente, updatedAt: excecaoEm };
  }
  const horas = horasDaData(perfil, data);
  return { source: 'habitual', periods: periodosDoTexto(horas), hours: horas, absent: /folga|não atende|não vou atender/i.test(horas) };
}

/** `professionalPeriodTimestamps`: períodos do dia operacional de 06h a 06h, inclusive na madrugada. */
function instantesDosPeriodos(periodos, data) {
  // v706: instantes por São Paulo real; a âncora 06:00 é só convenção de armazenamento da escala (escala-relogio-civil.js).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !Number.isFinite(Date.parse(data))) return [];
  return periodos.filter((p) => HORA_VALIDA.test(p.start) && HORA_VALIDA.test(p.end))
    .map((p) => {
      const inicio = Date.parse(RC.instanteDoRelogioLegado(data, p.start));
      let diaFim = RC.dataCivilDoRelogioLegado(data, p.end);
      if (p.end === RC.LEGACY_SCHEDULE_DAY_START && RC.minutosDoRelogioLegado(p.start) > RC.LEGACY_SCHEDULE_DAY_START_MINUTES) diaFim = somarDias(data, 1);
      return { ...p, startsAt: inicio, endsAt: Date.parse(saoPauloWallTimestamp(diaFim, p.end)) };
    })
    .filter((p) => p.endsAt > p.startsAt)
    .sort((a, b) => a.startsAt - b.startsAt);
}

/** `nextShiftPeriod`: o próximo período que começa depois de `agora`, com instantes ISO. */
function proximoPeriodo(periodos, data, agora) {
  const prox = instantesDosPeriodos(periodos, data).find((p) => p.startsAt > agora);
  return prox ? { start: prox.start, end: prox.end, startsAt: new Date(prox.startsAt).toISOString(), endsAt: new Date(prox.endsAt).toISOString() } : undefined;
}

/** `professionalPeriodsOnDate`: sem o calendário de demonstração, uma janela declarada vale na sua data. */
function periodosNaData(perfil, excecoes, data) {
  if (!perfil) return [];
  const escala = escalaNaData(perfil, excecoes, data);
  if (!escala.instants) return escala.periods;
  return diaOperacionalDoInstante(escala.instants.startsAt) === data ? escala.periods : [];
}

module.exports = {
  HORA_VALIDA, milissegundos, diaOperacionalDoInstante, relogio, formatarHora, formatarPeriodos, periodosDoTexto, horasDaData,
  excecaoNaData, semanaDaData, retornoSubstituido, escalaNaData, instantesDosPeriodos, proximoPeriodo, periodosNaData, somarDias,
};
