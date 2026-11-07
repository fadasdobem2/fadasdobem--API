'use strict';

/**
 * Domínio puro da Escala (sábado, feriado e domingo excepcional) das tarólogas, porte versionado de `features/escala/roster-model.ts`
 * do front (versão v706 da Nice mais a correção nossa do limiar de quinta, `saturdayRosterRequestOpen`). Usa a escala efetiva do dia
 * (`presenca-agenda.escalaNaData`, que é `professionalScheduleOnDate`). Novidades da v706 portadas aqui:
 *   - domingo só participa da escala com funcionamento excepcional registrado (resposta datada, horário, confirmação ou retorno);
 *   - horário confirmado ou retorno informado na presença vence a exceção e a habitual em `rosterEntry`;
 *   - só se edita hoje ou data futura, e nunca um domingo fechado; rótulo de origem coerente com a data e a resposta.
 * Sem banco, sem Express. Se o front mudar a regra, regerar os casos de `scripts/verificar-gf-escala.js`.
 */

const { somarDias } = require('./horarios');
const { periodosDoTexto, horasDaData, excecaoNaData, escalaNaData } = require('./presenca-agenda');

const diaDaSemana = (data) => new Date(`${data}T12:00:00Z`).getUTCDay();
const FOLGA_OU_NAO_ATENDE = /folga|não atende/i;
const FOLGA_OU_NAO_ATENDE_EXCECAO = /não atende|folga/i;

const canManageRoster = (papel) => ['administradora', 'assistente', 'supervisora', 'atendente'].includes(papel);
const canConfigureRoster = (papel) => ['administradora', 'assistente', 'supervisora'].includes(papel);
const nextRosterSaturday = (hoje) => somarDias(hoje, (6 - diaDaSemana(hoje) + 7) % 7);
const isSpecialRosterDate = (data, feriados) => diaDaSemana(data) === 6 || feriados.some((f) => f.date === data);

/** Domingo só participa da escala quando há funcionamento excepcional registrado. */
function isRosterScheduleDate(perfil, excecoes, data, feriados) {
  if (isSpecialRosterDate(data, feriados)) return true;
  if (diaDaSemana(data) !== 0) return false;
  const ex = excecaoNaData(excecoes, perfil.id, data);
  const respostaDatada = ex && ex.rosterResponse && ex.startDate === data && ex.endDate === data;
  const real = escalaNaData(perfil, excecoes, data);
  return Boolean(respostaDatada || (ex && ex.periods.length) || periodosDoTexto(horasDaData(perfil, data)).length || real.source === 'confirmed' || real.source === 'return');
}
const isClosedRosterSunday = (perfil, excecoes, data, feriados) => diaDaSemana(data) === 0 && !isRosterScheduleDate(perfil, excecoes, data, feriados);
const canEditOwnHoursDate = (perfil, excecoes, data, hoje, feriados) => data >= hoje && !isClosedRosterSunday(perfil, excecoes, data, feriados);

function rosterEntry(perfil, excecoes, data, feriados) {
  const override = excecaoNaData(excecoes, perfil.id, data);
  const real = escalaNaData(perfil, excecoes, data);
  if (real.source === 'confirmed' || real.source === 'return') return { status: real.periods.length ? 'working' : 'pending', hours: real.hours, periods: real.periods, override, habitual: false };
  if (override) {
    const ausente = override.absenceType !== 'Nenhuma' || FOLGA_OU_NAO_ATENDE_EXCECAO.test(override.todayHours);
    const periodos = ausente ? [] : override.periods;
    if (!ausente && !periodos.length && isClosedRosterSunday(perfil, excecoes, data, feriados)) return { status: 'off', hours: 'Folga', periods: [], override, habitual: false };
    return { status: ausente ? 'off' : periodos.length ? 'working' : 'pending', hours: override.todayHours, periods: periodos, override, habitual: false };
  }
  const horas = horasDaData(perfil, data); const periodos = periodosDoTexto(horas);
  if (isClosedRosterSunday(perfil, excecoes, data, feriados)) return { status: 'off', hours: 'Folga', periods: [], override, habitual: true };
  // Horário fixo de sábado já foi informado no cadastro. Feriados continuam pedindo uma resposta por data.
  if (feriados.some((f) => f.date === data) || (isSpecialRosterDate(data, feriados) && !periodos.length)) return { status: 'pending', hours: 'Não informou', periods: [], override, habitual: false };
  const folga = FOLGA_OU_NAO_ATENDE.test(horas);
  return { status: periodos.length ? 'working' : folga ? 'off' : 'pending', hours: periodos.length || folga ? horas : 'Não informou', periods: periodos, override, habitual: true };
}

/** O pedido do sábado à taróloga começa 2 dias antes (quinta); o aviso da equipe usa a mesma regra. */
const saturdayRosterRequestOpen = (hoje) => hoje >= somarDias(nextRosterSaturday(hoje), -2);

function relatedRosterSaturday(data) {
  const dia = diaDaSemana(data);
  return dia === 5 ? somarDias(data, 1) : dia === 6 ? data : dia === 0 ? somarDias(data, -1) : dia === 1 ? somarDias(data, -2) : undefined;
}

function hasRosterAnswer(excecoes, id, data) {
  const e = excecaoNaData(excecoes, id, data);
  return Boolean(e && (e.absenceType !== 'Nenhuma' || e.periods.length || FOLGA_OU_NAO_ATENDE_EXCECAO.test(e.todayHours)));
}

function pendingRosterDates(tarotId, hoje, feriados, excecoes, perfil) {
  const sabado = nextRosterSaturday(hoje); const alvos = new Set();
  if (saturdayRosterRequestOpen(hoje)) alvos.add(sabado);
  const grupos = new Map();
  for (const f of feriados) {
    const ligado = relatedRosterSaturday(f.date);
    if (ligado) grupos.set(ligado, [...(grupos.get(ligado) || []), f]);
    else if (f.remindFrom <= hoje && hoje <= f.date) alvos.add(f.date);
  }
  for (const [ligado, datas] of grupos) {
    // Um único pedido: o primeiro aviso do grupo traz as demais datas relacionadas.
    const inicio = [somarDias(ligado, -2), ...datas.map((x) => x.remindFrom)].sort()[0];
    if (hoje >= inicio) [ligado, ...datas.map((x) => x.date)].forEach((d) => alvos.add(d));
  }
  return [...alvos].sort().filter((d) => d >= hoje && !hasRosterAnswer(excecoes, tarotId, d) && (!perfil || rosterEntry(perfil, excecoes, d, feriados).status === 'pending'));
}

function ownUpcomingHoursDates(perfil, excecoes, hoje, feriados) {
  const datas = new Set(Object.entries(excecoes).filter(([chave, e]) => (chave === perfil.id || chave.startsWith(`${perfil.id}@`)) && e.startDate === e.endDate && e.startDate > hoje).map(([, e]) => e.startDate));
  return [...datas].sort().filter((d) => hasRosterAnswer(excecoes, perfil.id, d)).map((d) => ({ date: d, ...rosterEntry(perfil, excecoes, d, feriados) }));
}
const ownUpcomingRosterDates = (perfil, excecoes, hoje, feriados) => ownUpcomingHoursDates(perfil, excecoes, hoje, feriados).filter((i) => isRosterScheduleDate(perfil, excecoes, i.date, feriados));

/** A origem visual corresponde à data e à resposta, não apenas à existência de override. */
function ownHoursOriginLabel(perfil, excecoes, data, feriados) {
  const entrada = rosterEntry(perfil, excecoes, data, feriados);
  if (entrada.status === 'pending' || isClosedRosterSunday(perfil, excecoes, data, feriados)) return undefined;
  const real = escalaNaData(perfil, excecoes, data);
  if (real.source === 'confirmed') return 'Horário confirmado';
  if (real.source === 'return') return 'Retorno informado';
  if (!entrada.override) return 'Horário habitual';
  const respostaDaData = entrada.override.startDate === data && entrada.override.endDate === data;
  if (respostaDaData && isRosterScheduleDate(perfil, excecoes, data, feriados)) return 'Escala informada';
  return entrada.override.absenceType !== 'Nenhuma' ? 'Ausência informada' : 'Horário informado';
}

module.exports = {
  canManageRoster, canConfigureRoster, nextRosterSaturday, isSpecialRosterDate, isRosterScheduleDate, isClosedRosterSunday, canEditOwnHoursDate,
  rosterEntry, saturdayRosterRequestOpen, relatedRosterSaturday, hasRosterAnswer, pendingRosterDates, ownUpcomingHoursDates, ownUpcomingRosterDates, ownHoursOriginLabel,
};
