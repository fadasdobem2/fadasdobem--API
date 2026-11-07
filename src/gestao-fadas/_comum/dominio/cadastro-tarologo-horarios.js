'use strict';

/**
 * Horário semanal estruturado do cadastro de tarólogos (v706), portado de `professionals/registration-model.ts` (`validatedSchedule`, campos
 * `weeklyScheduleEffectiveFrom`/`Base`/`Versions`), `professionals/registration-schedule.ts` (`prepareRegistrationSchedule`) e
 * `domain/formatters.ts` (`weeklyScheduleForDate`). O mapa editável é a escala PROPOSTA; a base e as versões guardam as datas já combinadas.
 * Funções puras. `hoje` é o dia operacional do servidor (`hojeOperacional`).
 */

const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const SEM_HORARIO = /^(folga|não atende|não vou atender|horário não informado|horário a informar|sem horário informado|por escala)$/i;

const ehData = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
const clonar = (x) => JSON.parse(JSON.stringify(x));
const mesma = (a = {}, b = {}) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/**
 * `validatedSchedule`: `ajuda` = { texto(valor, rotulo, max), objeto(valor, rotulo), periodos(texto) -> lista validada ou lança, formatar(lista), falha(msg) }
 * injetada por `cadastro-tarologo.js` (evita dependência circular).
 */
function semanaValida(entrada, ajuda) {
  const semana = entrada === undefined ? {} : ajuda.objeto(entrada, 'Horários');
  const r = {};
  for (const dia of DIAS) {
    if (semana[dia] === undefined) continue;
    const horas = ajuda.texto(semana[dia], `Horário de ${dia}`, 240);
    if (!horas || SEM_HORARIO.test(horas)) { r[dia] = horas; continue; }
    let ps;
    try { ps = ajuda.periodos(horas); } catch (_e) { throw ajuda.falha(`Confira os horários de ${dia}. Use períodos como 9h às 12h e 14h às 18h, ou Folga.`); }
    r[dia] = ajuda.formatar(ps);
  }
  return r;
}

/** Campos de vigência (só na ficha da administração; o envio público não os traz nem os lê). */
function vigencias(dados, resultado, ajuda) {
  if (dados.weeklyScheduleEffectiveFrom) {
    if (!ehData(dados.weeklyScheduleEffectiveFrom)) throw ajuda.falha('Confira a data em Válido a partir de.');
    resultado.weeklyScheduleEffectiveFrom = dados.weeklyScheduleEffectiveFrom;
  }
  if (dados.weeklyScheduleBase !== undefined) resultado.weeklyScheduleBase = semanaValida(dados.weeklyScheduleBase, ajuda);
  if (dados.weeklyScheduleVersions !== undefined) {
    if (!Array.isArray(dados.weeklyScheduleVersions) || dados.weeklyScheduleVersions.length > 200) throw ajuda.falha('Histórico de horários inválido.');
    resultado.weeklyScheduleVersions = dados.weeklyScheduleVersions.map((v) => {
      const versao = ajuda.objeto(v, 'Vigência dos horários');
      if (!ehData(versao.effectiveFrom)) throw ajuda.falha('Confira a vigência dos horários.');
      return { effectiveFrom: versao.effectiveFrom, schedule: semanaValida(versao.schedule, ajuda) };
    }).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    if (new Set(resultado.weeklyScheduleVersions.map((x) => x.effectiveFrom)).size !== resultado.weeklyScheduleVersions.length) throw ajuda.falha('Há mais de uma escala com a mesma vigência.');
  }
  return resultado;
}

/** `weeklyScheduleForDate`: a versão com vigência mais recente até a data; sem versão, o mapa histórico. */
function horarioNaData(perfil, data) {
  const versao = [...(perfil.weeklyScheduleVersions || [])].filter((v) => v.effectiveFrom <= data).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  return (versao && versao.schedule) || perfil.weeklySchedule || {};
}

/** `prepareRegistrationSchedule`: baseline + versões preservam as datas já combinadas quando o horário proposto muda. */
function prepararHorario(proximo, anterior, hoje) {
  const vigencia = proximo.weeklyScheduleEffectiveFrom || (mesma(proximo.weeklySchedule, anterior && anterior.weeklySchedule) ? anterior && anterior.weeklyScheduleEffectiveFrom : undefined) || hoje;
  if (anterior && mesma(proximo.weeklySchedule, anterior.weeklySchedule) && vigencia === (anterior.weeklyScheduleEffectiveFrom || hoje)) {
    return {
      ...proximo,
      ...(anterior.weeklyScheduleEffectiveFrom ? { weeklyScheduleEffectiveFrom: anterior.weeklyScheduleEffectiveFrom } : {}),
      ...(anterior.weeklyScheduleBase ? { weeklyScheduleBase: clonar(anterior.weeklyScheduleBase) } : {}),
      ...(anterior.weeklyScheduleVersions ? { weeklyScheduleVersions: clonar(anterior.weeklyScheduleVersions) } : {}),
    };
  }
  if (!anterior && !proximo.weeklyScheduleEffectiveFrom && !(proximo.weeklyScheduleVersions || []).length) return proximo;
  const base = (anterior && (anterior.weeklyScheduleBase || anterior.weeklySchedule)) || proximo.weeklyScheduleBase || {};
  const antiga = anterior && anterior.weeklyScheduleEffectiveFrom;
  const versoes = ((anterior && anterior.weeklyScheduleVersions) || proximo.weeklyScheduleVersions || []).filter((v) => v.effectiveFrom !== vigencia
    && !(antiga && antiga > hoje && antiga !== vigencia && mesma(proximo.weeklySchedule, anterior && anterior.weeklySchedule) && v.effectiveFrom === antiga));
  return { ...proximo, weeklyScheduleEffectiveFrom: vigencia, weeklyScheduleBase: clonar(base), weeklyScheduleVersions: [...versoes, { effectiveFrom: vigencia, schedule: clonar(proximo.weeklySchedule) }].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)) };
}

/** Envio por link individual (`registration-demo-storage`/`registration-service`): o horário muda só se mudou; vigência, base e versões são as da ficha. */
function horarioDoEnvioPorLink(enviado, anterior) {
  const igual = Object.keys({ ...enviado.weeklySchedule, ...anterior.weeklySchedule }).every((d) => enviado.weeklySchedule[d] === anterior.weeklySchedule[d]);
  return { ...enviado, weeklyScheduleEffectiveFrom: igual ? anterior.weeklyScheduleEffectiveFrom : undefined, weeklyScheduleBase: anterior.weeklyScheduleBase, weeklyScheduleVersions: anterior.weeklyScheduleVersions };
}

module.exports = { DIAS, SEM_HORARIO, ehData, semanaValida, vigencias, horarioNaData, prepararHorario, horarioDoEnvioPorLink };
