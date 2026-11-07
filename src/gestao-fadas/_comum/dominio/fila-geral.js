'use strict';

/**
 * Fila geral, parte 2 (domínio puro): reservas da fila geral para uma taróloga e suas transformações. Porte versionado do CÓDIGO do front
 * (Maturacao/29 seção 11): agenda/general-reservations.ts (inteiro), painel/panel-flow-model.ts (`prepareGeneralReservation` :344,
 * `reserveGeneralClient` :357, `releaseGeneralReservation` :363, `routeGeneral` :289), agenda/agenda-deferral.ts (`clearAgendaDeferral`),
 * agenda/agenda-history.ts (`recordAgendaScheduleChange`). As funções de transformação devolvem o agendamento novo; quem chama grava.
 * `agora` é sempre o instante do SERVIDOR em milissegundos.
 */

const { randomUUID } = require('crypto');
const { contatoDe, encerrado, ativoNoDia } = require('./agenda-contato');
const b = require('./fila-geral-base');

const { FILA_GERAL } = b;

// general-reservations.ts:30-35
function liberacaoImediataFeita(item) {
  const l = item.immediateReservationRelease;
  return Boolean(l && l.tarotId === ((item.queueReservation && item.queueReservation.tarotId) ?? item.tarotId) && l.date === item.date && l.scheduledTime === item.scheduledTime && l.requestedTime === item.requestedTime);
}
// general-reservations.ts:12-17: um retorno gravado depois da reserva encerrou aquela atribuição humana
function reservaFoiAdiada(item) {
  if (!item.queueReservation) return false;
  const reservadoEm = Date.parse(item.queueReservation.at);
  return (item.contactHistory || []).some((e) => e.active && ((e.after || []).some(b.ehEtiquetaQueLiberaReserva) || b.ehEtiquetaQueLiberaReserva(e.tag))
    && Number.isFinite(Date.parse(e.at)) && (!Number.isFinite(reservadoEm) || Date.parse(e.at) >= reservadoEm));
}
// general-reservations.ts:21-24: quem foi adiada não segura uma taróloga agora
function reservaAtiva(item, data, agora) {
  return Boolean(item.queueReservation) && !liberacaoImediataFeita(item) && item.tarotId === FILA_GERAL && !encerrado(item) && item.workflowStatus !== 'Em consulta'
    && ativoNoDia(item, data, data) && !b.reservaJaExpirou(item) && !b.recessoComum(item) && !b.temEstadoDeRetorno(item) && !reservaFoiAdiada(item) && b.planoPermiteContato(item, data, agora);
}
// general-reservations.ts:28-33
function reservaComecaEm(item, data, agora) {
  const reservadoEm = Date.parse((item.queueReservation && item.queueReservation.at) ?? '');
  const pedido = b.instantePedido(item, data);
  return Math.max(Number.isFinite(reservadoEm) ? reservadoEm : -Infinity, pedido ?? -Infinity);
}
const correndo = (v) => v.status === 'Em curso' && !v.tarologistFinishReport;
// general-reservations.ts:38-49: uma taróloga tem UMA reserva vigente; as demais ficam pendentes na fila geral
function reservas(agenda, tarotId, data, consultas = [], agora = Date.now()) {
  const ocupada = Boolean(b.conflitoDeContinuacao(consultas, tarotId)) || consultas.some((v) => v.tarotId === tarotId && correndo(v));
  return agenda.filter((item) => item.queueReservation && item.queueReservation.tarotId === tarotId && reservaAtiva(item, data, agora)
    && (!ocupada || b.instantePedido(item, data) === null)
    && !consultas.some((v) => v.clientId === item.clientId && correndo(v))
    && !b.consultasQueCasam(item, consultas, data).some((v) => !b.correspondenciaMantida(item, v)))
    .sort((p, q) => (reservaComecaEm(p, data, agora) - reservaComecaEm(q, data, agora)) || (Date.parse(p.queueReservation.at) - Date.parse(q.queueReservation.at)) || p.id.localeCompare(q.id))
    .slice(0, 1);
}
// general-reservations.ts:51-53
const conflitoDeReserva = (agenda, consultas, tarotId, data, clientId, agendaId, agora = Date.now()) => reservas(agenda, tarotId, data, consultas, agora).find((r) => r.id !== agendaId || r.clientId !== clientId);

// general-reservations.ts:59-63: o agendamento fica byte a byte igual, salvo esta marca
function liberarReservaPropria(item, tarotId, ator, agora) {
  return item.tarotId === tarotId && tarotId !== FILA_GERAL && !encerrado(item) && item.workflowStatus !== 'Em consulta' && !liberacaoImediataFeita(item)
    ? { ...item, immediateReservationRelease: { tarotId, date: item.date, scheduledTime: item.scheduledTime, requestedTime: item.requestedTime, at: new Date(agora).toISOString(), by: ator } } : item;
}

// agenda-deferral.ts:6-13
function limparAdiamento(item, ator, em) {
  const atual = item.queueDeferral;
  if (!atual) return item;
  return { ...item, queueDeferral: undefined, queueDeferralHistory: [...(item.queueDeferralHistory ?? []), { ...atual, at: em, by: ator, active: false }] };
}

// agenda-history.ts:9-31 (v706: o retrato do agendamento passa a guardar canal e minutos pedidos)
const fotoDoAgendamento = (item) => ({ channel: item.channel, requestedMinutes: item.requestedMinutes, standbyDate: item.standbyDate, date: item.date || '2026-09-01', scheduledTime: item.scheduledTime || '', requestedTime: item.requestedTime || '', tarotId: item.tarotId,
  ...(item.contactPlan ? { contactPlan: { ...item.contactPlan, shift: item.contactPlan.shift ? { ...item.contactPlan.shift } : undefined } } : {}) });
function registrarMudancaDeAgendamento(antes, depois, ator, em, novoId = randomUUID) {
  if (antes.clientId !== `${depois.clientId}`.trim()) throw new Error('Para outra cliente, cancele este agendamento e crie um novo.');
  const a = JSON.stringify(fotoDoAgendamento(antes)); const d = JSON.stringify(fotoDoAgendamento(depois));
  if (a === d) return depois;
  return { ...depois, scheduleHistory: [...(antes.scheduleHistory || []), { id: novoId(), actor: ator, at: em, beforeActor: (antes.scheduleHistory || []).at(-1)?.actor || antes.createdBy, before: fotoDoAgendamento(antes), after: fotoDoAgendamento(depois) }] };
}

// panel-flow-model.ts:47-58 (só o que `prepareGeneralReservation` usa: `future`)
const emFuturo = (item, data, agora) => { const pedido = b.instantePedido(item, data); return (item.date ?? data) > data || (pedido !== null && pedido > agora); };

/** panel-flow-model.ts:344-353: encaminhar retoma o contato SEM inventar resposta da cliente; respostas e horário antigos ficam no histórico. */
function prepararReserva(item, data, agora, ator, novoId = randomUUID) {
  const emFuturoAgora = emFuturo(item, data, agora);
  if (!b.temEstadoDeRetorno(item) && !b.retornoAgendadoDaEquipe(item) && !b.recessoComum(item) && !emFuturoAgora) return item;
  const em = new Date(agora).toISOString(); const contato = contatoDe(item); const base = limparAdiamento(item, ator, em);
  if (!contato.tags.some(b.ehEtiquetaDeRetorno) && !b.recessoComum(item) && !emFuturoAgora) return base;
  const retomado = { ...base, date: data, scheduledTime: undefined, requestedTime: undefined, standbyDate: undefined, ...(item.contactPlan ? { contactPlan: { who: 'staff', timing: 'none' } } : {}),
    workflowStatus: undefined, response: 'Aguardando resposta', contact: { attempt: contato.attempt + 1, date: data, tags: [] },
    reservationClock: item.reservationClock ? { ...item.reservationClock, active: false } : undefined };
  return registrarMudancaDeAgendamento(item, retomado, ator, em, novoId);
}

/** panel-flow-model.ts:357-362: a reserva fica presa ao registro original da fila geral (sem segunda entrada). Devolve o item (igual se já reservada). */
function reservarCliente(item, tarotId, ator, data, agora, novoId = randomUUID) {
  if (item.queueReservation && item.queueReservation.tarotId === tarotId && reservaAtiva(item, data, agora)) return item;
  const em = new Date(agora).toISOString(); const preparado = prepararReserva(item, data, agora, ator, novoId);
  return { ...preparado, immediateReservationRelease: undefined, queueReservation: { tarotId, at: em, by: ator },
    queueReservationHistory: [...(item.queueReservationHistory ?? []), { tarotId, previousTarotId: item.queueReservation && item.queueReservation.tarotId, at: em, by: ator }] };
}

/** panel-flow-model.ts:363-370: liberar mantém a cliente em Esperando; reserva de horário marcado só ganha a marca de liberação. */
function liberarReserva(item, ator, agora) {
  if (item.tarotId !== FILA_GERAL || !item.queueReservation || liberacaoImediataFeita(item)) return item;
  const em = new Date(agora).toISOString(); const tarotId = item.queueReservation.tarotId;
  return { ...item, ...(item.scheduledTime ? { immediateReservationRelease: { tarotId, date: item.date, scheduledTime: item.scheduledTime, requestedTime: item.requestedTime, at: em, by: ator } } : { queueReservation: undefined }),
    queueReservationHistory: [...(item.queueReservationHistory ?? []), { previousTarotId: tarotId, at: em, by: ator }] };
}

/** panel-flow-model.ts:289-296: encaminha para a fila da taróloga (sai da fila geral). `posicao` é a seguinte da fila dela no dia. */
function encaminharParaTarologa(item, tarotId, ator, data, agora, posicao, novoId = randomUUID) {
  const em = new Date(agora).toISOString();
  return registrarMudancaDeAgendamento(item, { ...prepararReserva(item, data, agora, ator, novoId), tarotId, date: data, position: posicao, positionOverrides: undefined,
    forwardedAt: undefined, forwardedBy: undefined, forwardedDate: undefined, standbyDate: undefined, scheduledTime: undefined }, ator, em, novoId);
}
const proximaPosicaoDe = (agenda, tarotId, data) => Math.max(0, ...agenda.filter((r) => r.tarotId === tarotId && ativoNoDia(r, data, data)).map((r) => r.position)) + 1;

module.exports = {
  FILA_GERAL, liberacaoImediataFeita, reservaFoiAdiada, reservaAtiva, reservaComecaEm, reservas, conflitoDeReserva, liberarReservaPropria, limparAdiamento,
  fotoDoAgendamento, registrarMudancaDeAgendamento, prepararReserva, reservarCliente, liberarReserva, encaminharParaTarologa, proximaPosicaoDe,
};
