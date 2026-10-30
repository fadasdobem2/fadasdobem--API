'use strict';

/**
 * Domínio puro da presença, parte 2: previsão de retorno, rótulos do estado e "desde quando está offline" (porte versionado de
 * `tarologas/presence-return-forecast.ts`, `tarologas/staff-presence-model.ts` (rótulos), `tarologas/reader-presence-return.ts` e
 * `expectedReturnTimestamp`/`pauseReturnTimestamp` de `tarologas/tarologist-presence.ts`). As recusas são `RegraPresencaError`
 * com a mesma mensagem do `throw new Error` do front; o service as devolve como 422 RULE_VIOLATION.
 */

const { somarDias, HORA_VALIDA, milissegundos, relogio, formatarHora, instantesDosPeriodos, proximoPeriodo, periodosNaData, escalaNaData, retornoSubstituido } = require('./presenca-agenda');

class RegraPresencaError extends Error {
  constructor(mensagem) { super(mensagem); this.name = 'RegraPresencaError'; }
}
const regra = (mensagem) => new RegraPresencaError(mensagem);

const PADRAO_DIA = /^\d{4}-\d{2}-\d{2}$/;
const ehData = (d) => PADRAO_DIA.test(d) && Number.isFinite(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
const dataCurta = (d) => d.split('-').reverse().join('/');
const diaCivil = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
/** `operationTimestamp` sem calendário de demonstração: a data civil e a hora vão para um instante real. */
const instanteDe = (data, hora) => new Date(`${data}T${hora.length === 5 ? `${hora}:00` : hora}-03:00`).toISOString();

/** `expectedReturnTimestamp`: horário de retorno (madrugada e 06:00 depois de `depois` vão para o dia seguinte). */
function retornoEsperado(data, hora, agora, depois) {
  if (!HORA_VALIDA.test(hora)) throw regra('Informe por volta de que horas você pretende voltar.');
  const diaSeguinte = Number(hora.slice(0, 2)) < 6 || (hora === '06:00' && depois !== undefined);
  const valor = Date.parse(instanteDe(diaSeguinte ? somarDias(data, 1) : data, hora));
  if (valor <= agora) throw regra('Esse horário já passou. Informe um horário futuro.');
  return new Date(valor).toISOString();
}

function retornoDaPausa(minutos, agora) {
  if (!Number.isInteger(minutos) || minutos < 1 || minutos > 1440) throw regra('Informe a duração da pausa em minutos, entre 1 e 1440.');
  return new Date(agora + minutos * 60_000).toISOString();
}

/** `nextProfessionalReturnPeriod`: a próxima escala efetiva, incluindo ausências e exceções futuras. */
function proximoPeriodoDeRetorno(perfil, excecoes, data, agora) {
  const datas = new Set();
  const semana = (inicio) => { if (ehData(inicio)) for (let d = 0; d <= 7; d += 1) datas.add(somarDias(inicio, d)); };
  semana(data);
  for (const [chave, ex] of Object.entries(excecoes)) {
    if ((chave === perfil.id || chave.startsWith(`${perfil.id}@`)) && ex.endDate >= data) { semana(ex.startDate < data ? data : ex.startDate); semana(ex.endDate); }
  }
  for (const dia of [...datas].filter((d) => d >= data).sort()) {
    const periodo = proximoPeriodo(periodosNaData(perfil, excecoes, dia), dia, agora);
    if (periodo) return { ...periodo, scheduleDate: dia, date: Number(periodo.start.slice(0, 2)) < 6 ? somarDias(dia, 1) : dia };
  }
  return undefined;
}

function fimResolvido(data, fim, agora, inicioHora, inicioEm) {
  if (!fim) return undefined;
  if (!HORA_VALIDA.test(fim)) throw regra('Informe um horário válido em Atende até.');
  const viraDia = Number(fim.slice(0, 2)) < 6 || fim === '06:00';
  const dataFim = viraDia && (!inicioHora || fim <= inicioHora) ? somarDias(data, 1) : data;
  const ate = instanteDe(dataFim, fim);
  if (Date.parse(ate) <= agora || (inicioEm && Date.parse(ate) <= Date.parse(inicioEm))) throw regra('O término deve ser depois do retorno.');
  return { endTime: fim, endDate: dataFim, until: ate };
}

/** `resolvePresenceReturn`: aproximações permanecem texto e não preenchem os instantes usados por reservas. */
function resolverRetorno(perfil, excecoes, dataOperacional, agora, entrada) {
  if (entrada.kind === 'next-shift') {
    const prox = proximoPeriodoDeRetorno(perfil, excecoes, dataOperacional, agora);
    if (!prox) return { forecast: { kind: 'next-shift' } };
    const fim = fimResolvido(prox.date, entrada.endTime || prox.end, agora, prox.start, prox.startsAt);
    return { forecast: { kind: 'next-shift', date: prox.date, scheduleDate: prox.scheduleDate, time: prox.start, endTime: fim.endTime, endDate: fim.endDate }, expectedReturn: prox.startsAt, returnUntil: fim.until };
  }
  const data = entrada.date ?? ''; const hoje = diaCivil(agora);
  if (!ehData(data) || data < hoje) throw regra('Escolha a data de retorno, hoje ou uma data futura.');
  const comHora = entrada.kind === 'approximate' || entrada.kind === 'exact';
  if (comHora && !HORA_VALIDA.test(entrada.time ?? '')) throw regra('Informe um horário de retorno válido.');
  const esperado = comHora ? instanteDe(data, entrada.time) : undefined;
  if (esperado && Date.parse(esperado) <= agora) throw regra('Esse horário já passou. Confira a data e informe um horário futuro.');
  if (entrada.kind === 'afternoon' && data === hoje && Date.parse(instanteDe(data, '18:00')) <= agora) throw regra('A tarde de hoje já passou. Escolha outra data.');
  if (entrada.endTime && HORA_VALIDA.test(entrada.endTime)) {
    const h = Number(entrada.endTime.slice(0, 2));
    if ((entrada.kind === 'afternoon' && h >= 6 && h < 12) || (entrada.kind === 'evening' && h >= 6 && h < 18)) throw regra('Atende até precisa ser depois do período de retorno informado.');
  }
  const fim = fimResolvido(data, entrada.endTime, agora, entrada.time, esperado);
  const scheduleDate = comHora && Number(entrada.time.slice(0, 2)) < 6 ? somarDias(data, -1) : data;
  const forecast = { kind: entrada.kind, date: data, scheduleDate };
  if (comHora) forecast.time = entrada.time;
  if (fim) { forecast.endTime = fim.endTime; forecast.endDate = fim.endDate; }
  return { forecast, expectedReturn: entrada.kind === 'exact' ? esperado : undefined, returnUntil: entrada.kind === 'exact' && fim ? fim.until : undefined };
}

function resumoDoRetorno(previsao) {
  const dia = previsao.date ? dataCurta(previsao.date) : '';
  const hora = previsao.time ? formatarHora(previsao.time) : '';
  const texto = previsao.kind === 'next-shift' ? `Volta no próximo turno${hora ? `, às ${hora}` : ''}` : previsao.kind === 'afternoon' ? 'Volta à tarde'
    : previsao.kind === 'evening' ? 'Volta à noite' : previsao.kind === 'approximate' ? `Volta por volta das ${hora}` : `Volta às ${hora}`;
  return `${texto}${dia ? ` · ${dia}` : ''}${previsao.endTime ? ` · atende até ${formatarHora(previsao.endTime)}${previsao.endDate && previsao.endDate !== previsao.date ? ` de ${dataCurta(previsao.endDate)}` : ''}` : ''}`;
}

const TURNO_PADRAO = (p) => p.shiftStatus ?? (!p.online ? 'Offline' : p.status === 'Pausa' ? 'Em pausa' : 'Disponível');
const ROTULOS = { available: 'Disponível', pause: 'Pausa', offline: 'Offline', missing: 'Sumiu', return: 'Volta no próximo turno', ended: 'Offline' };

/** `staffPresenceChoice`: a escolha de presença que o estado do perfil representa. */
function escolhaDaPresenca(perfil, data) {
  const status = TURNO_PADRAO(perfil);
  if (status === 'Em pausa') return 'pause';
  if (status !== 'Offline') return 'available';
  if (perfil.presenceDate === data && perfil.shiftExit === 'missing') return 'missing';
  if (perfil.presenceDate === data && perfil.shiftExit === 'ended') return 'ended';
  if (perfil.shiftExit === 'return' && (perfil.presenceDate === data || perfil.returnForecast)) return 'return';
  return 'offline';
}
const rotuloDaPresenca = (perfil, data) => { const c = escolhaDaPresenca(perfil, data); return c === 'return' ? 'Offline' : ROTULOS[c]; };

function detalheDaPresenca(perfil, data, excecoes = {}) {
  const estado = escolhaDaPresenca(perfil, data);
  if (estado === 'ended') return 'Offline · atendimento após confirmar disponibilidade';
  if (estado === 'return' && retornoSubstituido(perfil, excecoes)) return `Horário informado: ${escalaNaData(perfil, excecoes, data).hours || 'Horário não informado'}`;
  if (estado === 'return') return perfil.returnForecast ? resumoDoRetorno(perfil.returnForecast) : perfil.expectedReturn ? `Volta às ${relogio(milissegundos(perfil.expectedReturn))}${perfil.returnUntil ? ` · atende até ${relogio(milissegundos(perfil.returnUntil))}` : ''}` : 'Volta no próximo turno';
  if (estado === 'offline') return 'Offline';
  if (estado === 'missing') return 'Não está respondendo';
  if (estado === 'pause') return `${perfil.pauseReason || 'Pausa'} · ${perfil.expectedReturn ? `retorno previsto às ${relogio(milissegundos(perfil.expectedReturn))}` : 'retorno não informado'}`;
  return 'Disponível para atender';
}

/** `readerOfflineSince`: usa só a transição mais recente e nunca cruza uma confirmação posterior de disponibilidade. */
function offlineDesde(perfil) {
  const confirmado = Date.parse((perfil && perfil.presenceConfirmedAt) || '');
  const valido = (v) => Boolean(v && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)) && (!Number.isFinite(confirmado) || Date.parse(v) >= confirmado));
  const offlineAt = perfil && perfil.presenceConfirmation && perfil.presenceConfirmation.offlineAt;
  if (valido(offlineAt)) return offlineAt;
  const ultimo = perfil && perfil.presenceHistory && perfil.presenceHistory[perfil.presenceHistory.length - 1];
  return ultimo && /^(?:Offline|Volta no próximo turno)(?:\s|$)/.test(ultimo.after) && valido(ultimo.at) ? ultimo.at : undefined;
}

module.exports = {
  proximoPeriodoDeRetorno, RegraPresencaError, retornoEsperado, retornoDaPausa, resolverRetorno, resumoDoRetorno, escolhaDaPresenca, rotuloDaPresenca, detalheDaPresenca,
  offlineDesde, TURNO_PADRAO, instantesDosPeriodos,
};
