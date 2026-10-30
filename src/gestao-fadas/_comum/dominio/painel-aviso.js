'use strict';

/**
 * Painel, aviso de disponibilidade ao agendar (domínio puro, Maturacao/39). Porte versionado do CÓDIGO do front:
 * `agenda/schedule-availability-notice.ts` (`scheduleAvailabilityNotice`), `tarologas/staff-presence-model.ts:97` (`bookingReturnPeriod`),
 * `tarologas/presence-return-forecast.ts` (`presenceReturnSummary`, `presenceReturnDayLabel`; `nextProfessionalReturnPeriod` já está em
 * `presenca-retorno.js`). Nomes de dia da semana por TABELA FIXA (pt-BR, sem Intl). A `key` do aviso é a chave de confirmação
 * (`availabilityConfirmation`): o front só agenda se a confirmação enviada for igual a ela. Relógio injetado (`now`).
 */

const { escalaNaData, formatarHora, formatarPeriodos, excecaoNaData, retornoSubstituido, instantesDosPeriodos, diaOperacionalDoInstante } = require('./presenca-agenda');
const { proximoPeriodoDeRetorno } = require('./presenca-retorno');
const adm = require('./admissao');
const t = require('./painel-tempo');
const { relogioSP } = t;

const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const HORA = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ehData = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
const dataCurta = (d) => d.split('-').reverse().join('/');
/** `saoPauloDateKey(new Date(ms))`: a data CIVIL de São Paulo (sem a virada das 06h). */
const dataCivil = (ms) => new Date(ms - 3 * 3600000).toISOString().slice(0, 10);
const instanteCivil = (data, hora) => Date.parse(`${data}T${hora}:00-03:00`);

/** `presenceReturnDayLabel`. */
const rotuloDoDiaDeRetorno = (data, hoje) => `${data === hoje ? 'Hoje' : data === t.somarDia(hoje, 1) ? 'Amanhã' : SEMANA[new Date(`${data}T12:00:00Z`).getUTCDay()]}, ${dataCurta(data)}`;
/** `presenceReturnSummary`. */
function resumoDoRetorno(previsao, hoje) {
  const dia = previsao.date ? (hoje ? rotuloDoDiaDeRetorno(previsao.date, hoje) : dataCurta(previsao.date)) : '';
  const hora = previsao.time ? formatarHora(previsao.time) : '';
  const texto = previsao.kind === 'next-shift' ? `Volta no próximo turno${hora ? `, às ${hora}` : ''}` : previsao.kind === 'afternoon' ? 'Volta à tarde' : previsao.kind === 'evening' ? 'Volta à noite' : previsao.kind === 'approximate' ? `Volta por volta das ${hora}` : `Volta às ${hora}`;
  return `${texto}${dia ? ` · ${dia}` : ''}${previsao.endTime ? ` · atende até ${formatarHora(previsao.endTime)}${previsao.endDate && previsao.endDate !== previsao.date ? ` de ${dataCurta(previsao.endDate)}` : ''}` : ''}`;
}

/** `bookingReturnPeriod`. */
function periodoDeRetornoParaReserva(perfil, evento, data, excecoes = {}) {
  const escala = perfil ? escalaNaData(perfil, excecoes, data) : undefined;
  const eventoEm = evento && Number.isFinite(Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(evento.at) ? `${evento.at}-03:00` : evento.at)) ? Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(evento.at) ? `${evento.at}-03:00` : evento.at) : undefined;
  const retorno = evento && evento.date === data && evento.mode === 'on_return' && evento.returnTime && evento.endTime;
  if (retorno && (!escala || escala.source === 'habitual' || escala.updatedAt === undefined || eventoEm === undefined || eventoEm >= escala.updatedAt)) return { start: evento.returnTime, end: evento.endTime };
  const janela = !escala || !escala.instants || diaOperacionalDoInstante(escala.instants.startsAt) === data;
  return escala && (escala.source === 'return' || escala.source === 'confirmed') && janela ? escala.periods[0] : undefined;
}

/** `scheduleAvailabilityNotice`: `{ profile, overrides, date, time, requestedTime, timeKind, now, intakeEvents }`. Devolve o aviso (com `key`) ou undefined. */
function avisoDeDisponibilidade(entrada) {
  const { profile: perfil, overrides: excecoes, date: data, now: agora } = entrada; const eventos = entrada.intakeEvents || [];
  if (!perfil || perfil.id === 'afila' || !ehData(data) || !Number.isFinite(agora)) return undefined;
  if (entrada.time && !HORA.test(entrada.time)) return undefined;
  const hora = entrada.time || undefined; const hoje = t.hojeDe(agora); const hojeCivil = dataCivil(agora);
  const diaCivilDe = (d, h) => (Number(h.slice(0, 2)) < 6 ? t.somarDia(d, 1) : d);
  const alvoEm = instanteCivil(hora ? diaCivilDe(data, hora) : data, hora ?? '06:00');
  const referencia = hora ? alvoEm : data === hoje ? agora : alvoEm;
  const fimDoDia = instanteCivil(t.somarDia(data, 1), '06:00');
  const excecao = excecaoNaData(excecoes, perfil.id, data);
  const periodoRetorno = periodoDeRetornoParaReserva(perfil, adm.admissaoVigente(eventos, perfil.id, data, agora), data, excecoes);
  const escala = escalaNaData(perfil, excecoes, data);
  const periodos = periodoRetorno ? [periodoRetorno] : escala.periods;
  const usaDeclarado = escala.instants && (!periodoRetorno || (diaOperacionalDoInstante(escala.instants.startsAt) === data && escala.periods.some((p) => p.start === periodoRetorno.start && p.end === periodoRetorno.end)));
  let turnos = usaDeclarado ? escala.periods.map((p) => ({ ...p, ...escala.instants })) : instantesDosPeriodos(periodos, data);
  const offline = (perfil.shiftStatus ?? (!perfil.online ? 'Offline' : perfil.status === 'Pausa' ? 'Em pausa' : 'Disponível')) === 'Offline';
  const mesmoDiaDePresenca = perfil.presenceDate === hoje && data === hoje;
  const concluir = (tipo, texto, origem, detalhe, proximo, aproximado = false) => {
    const evidencia = { source: origem, periods: periodos, detail: detalhe };
    const pergunta = hora ? `Manter ${entrada.timeKind === 'after' ? 'a partir das' : 'às'} ${formatarHora(hora)}?` : 'Manter agendamento?';
    const key = JSON.stringify([perfil.id, data, hora ?? '', entrada.requestedTime ?? '', entrada.timeKind ?? 'exact', tipo, evidencia, proximo ?? null, aproximado]);
    return { key, message: `${texto} ${pergunta}`, description: texto, question: pergunta, kind: tipo, targetDate: data, targetTime: hora, returnDate: proximo && proximo.date, returnTime: proximo && proximo.time, approximate: aproximado, evidence: evidencia };
  };
  const proximoDepois = () => {
    const local = turnos.find((x) => x.startsAt > referencia);
    if (local) return { date: diaCivilDe(data, local.start), scheduleDate: data, time: local.start };
    const prox = proximoPeriodoDeRetorno(perfil, excecoes, t.somarDia(data, 1), agora);
    return prox ? { date: prox.date, scheduleDate: prox.scheduleDate, time: prox.start } : undefined;
  };
  const textoRetorno = (p) => `${p.date ? ` ${rotuloDoDia(p.date, hojeCivil)}` : ''}${p.time ? ` às ${formatarHora(p.time)}` : ''}`;
  function rotuloDoDia(d, h) { if (d === h) return 'hoje'; if (d === t.somarDia(h, 1)) return 'amanhã'; return `${SEMANA[new Date(`${d}T12:00:00Z`).getUTCDay()]}, ${dataCurta(d)}`; }
  if (offline && mesmoDiaDePresenca && perfil.shiftExit === 'ended') {
    const prox = proximoPeriodoDeRetorno(perfil, excecoes, t.somarDia(data, 1), agora);
    return concluir('ended', `${perfil.name} já encerrou hoje.`, 'presence', `ended:${perfil.presenceDate}:${(perfil.presenceConfirmation && perfil.presenceConfirmation.offlineAt) ?? ''}`, prox ? { date: prox.date, time: prox.start } : undefined);
  }
  if (offline && mesmoDiaDePresenca && perfil.shiftExit === 'shift-ended') {
    const fechou = Date.parse((perfil.presenceConfirmation && perfil.presenceConfirmation.offlineAt) ?? '');
    if (Number.isFinite(fechou)) turnos = turnos.filter((x) => !(fechou >= x.startsAt && fechou < x.endsAt));
  }
  const previsao = perfil.returnForecast;
  const retornoDeclarado = offline && perfil.shiftExit === 'return' && !retornoSubstituido(perfil, excecoes);
  if (retornoDeclarado && previsao && previsao.kind !== 'exact' && previsao.kind !== 'next-shift' && previsao.date) {
    const alvoCivil = hora ? diaCivilDe(data, hora) : data;
    if (alvoCivil <= previsao.date) return concluir('return', `${perfil.name}: ${resumoDoRetorno(previsao, hojeCivil)}. É uma previsão; confirme a disponibilidade.`, 'return', JSON.stringify(previsao), { date: previsao.date, time: previsao.time }, true);
  }
  const esperado = Date.parse(perfil.expectedReturn ?? ''); const ate = Date.parse(perfil.returnUntil ?? '');
  if (retornoDeclarado && (!previsao || previsao.kind === 'exact' || previsao.kind === 'next-shift') && Number.isFinite(esperado)) {
    const prox = { date: (previsao && previsao.date) ?? dataCivil(esperado), time: (previsao && previsao.time) ?? relogioSP(esperado) };
    if (referencia < esperado && ((hora && entrada.timeKind !== 'after') || esperado >= fimDoDia)) {
      const diaAlvo = hora ? diaCivilDe(data, hora) : data;
      const indisponivel = prox.date > diaAlvo ? ` ${rotuloDoDia(diaAlvo, hojeCivil).replace(/^./, (l) => l.toUpperCase())} fica antes desse retorno.` : '';
      return concluir('return', `${perfil.name} só voltará${textoRetorno(prox)}.${indisponivel}`, 'return', `${perfil.expectedReturn}:${perfil.returnUntil ?? ''}:${JSON.stringify(previsao ?? null)}`, prox);
    }
    if (!Number.isFinite(ate) && ((previsao && previsao.scheduleDate) ?? perfil.presenceDate) === data && (!hora || referencia >= esperado)) return undefined;
  }
  if (turnos.some((x) => referencia < x.endsAt && (!hora || entrada.timeKind === 'after' || referencia >= x.startsAt))) return undefined;
  const prox = proximoDepois();
  if (turnos.length || periodos.length) {
    if (prox && prox.date === diaCivilDe(data, prox.time)) return concluir('return', `${perfil.name} só voltará${textoRetorno(prox)}.`, 'schedule', formatarPeriodos(periodos), prox);
    const encerrou = !hora && data === hoje && turnos.every((x) => x.endsAt <= agora);
    const diaEscolhido = data === hoje ? 'hoje' : data === t.somarDia(hoje, 1) ? 'amanhã' : `em ${data.split('-').reverse().slice(0, 2).join('/')}`;
    const horas = periodos.map((p) => `das ${formatarHora(p.start)} às ${formatarHora(p.end)}`).join(' e ');
    const texto = encerrou ? `${perfil.name} já encerrou os horários de hoje.` : `${perfil.name} atende ${diaEscolhido} ${horas}.`;
    return concluir(encerrou ? 'ended' : 'outside-hours', texto, 'schedule', formatarPeriodos(periodos), prox);
  }
  const textoEscala = escala.hours;
  const ausenciaConhecida = Boolean(escala.source === 'override' && excecao && excecao.absenceType && excecao.absenceType !== 'Nenhuma');
  const folga = ausenciaConhecida || /folga|não atende|não vou atender/i.test(textoEscala);
  if (folga) {
    const motivo = /folga/i.test(ausenciaConhecida ? excecao.absenceType : textoEscala) ? 'está de folga' : ausenciaConhecida ? `está em ${excecao.absenceType.toLowerCase()}` : 'não atende';
    const diaEscolhido = data === hoje ? 'hoje' : data === t.somarDia(hoje, 1) ? 'amanhã' : `em ${data.split('-').reverse().slice(0, 2).join('/')}`;
    const resultado = concluir('absence', `${perfil.name} ${motivo} ${diaEscolhido}.`, excecao ? 'override' : 'schedule', ausenciaConhecida ? `${excecao.absenceType}:${excecao.startDate}:${excecao.endDate}` : textoEscala, prox);
    if (prox) {
      const rotulo = `Agendar para ${prox.date === hoje ? 'hoje' : prox.date === t.somarDia(hoje, 1) ? 'amanhã' : prox.date.split('-').reverse().slice(0, 2).join('/')}`;
      resultado.suggestion = { date: prox.scheduleDate, time: prox.time, label: rotulo, question: `${rotulo}?` };
    }
    return resultado;
  }
  if (offline && mesmoDiaDePresenca) {
    const detalhe = perfil.shiftExit === 'missing' ? 'não está respondendo' : retornoDeclarado ? 'informou que volta no próximo turno, sem horário confirmado' : 'está offline, sem horário de retorno confirmado';
    return concluir('offline', `${perfil.name} ${detalhe}.`, 'presence', `${perfil.shiftExit ?? 'offline'}:${perfil.presenceDate}`);
  }
  return undefined;
}

module.exports = { SEMANA, rotuloDoDiaDeRetorno, resumoDoRetorno, periodoDeRetornoParaReserva, avisoDeDisponibilidade };
