'use strict';

/**
 * Painel, continuação (pedido de mais tempo) e parada do contato (domínio puro, Maturacao/39). Porte versionado do CÓDIGO do front:
 * `agenda-common-deadlines.ts:19-20` (`commonAgendaStopped`), `agenda/continuation-priority.ts:14` (`continuationArchived`),
 * `agenda/reader-continuation.ts` (`hydrateMoreTimeAgendaContact` :11, `continuationIsSuspended` :135), `agenda/continuation-queue-pair.ts:17`
 * (`queueAdvancePending`), `consultas/more-time-requests.ts` (`openMoreTimeRequests`, `moreTimeRequestedAt`), `consultas/more-time-agenda.ts:46`
 * (`agendaItemForMoreTime`) e `painel/panel-flow-model.ts:77-97` (`panelContinuationReservation(s)`). Relógio injetado (`agora`).
 */

const { contatoDe, encerrado } = require('./agenda-contato');
const b = require('./fila-geral-base');
const { alternarEtiqueta } = require('./agenda-etiqueta');
const t = require('./painel-tempo');

const ETAPAS_DE_PARADA = ['Não voltou', 'Não pode agora', 'Não pode', 'Cliente vai chamar', 'Chama depois', 'Próximo turno', 'Adiada', 'Cancelada', 'Concluída'];
const ESTADOS_COM_PEDIDO = ['Em curso', 'Concluída', 'Finalizada pelo tarólogo'];
const RETORNOS = ['Não respondeu', 'Não voltou', 'Não pode agora', 'Cliente vai chamar', 'Chama depois', 'Próximo turno'];

/** `consultationHasMoreTimeRequest` (tarologist-finish-report.ts:46). */
const pedidoDeMaisTempo = (c) => (c.tarologistMoreTimeRequest && c.tarologistMoreTimeRequest.active) ?? (c.tarologistFinishReport && c.tarologistFinishReport.clientWantsMoreTime) ?? false;
const pedidoDe = (c) => c.tarologistMoreTimeRequest;

const contatoParado = (item) => b.temEsperaAdiada(item) || (item.contactPlan && item.contactPlan.who) === 'client'
  || contatoDe(item).tags.some((tag) => (ETAPAS_DE_PARADA.includes(tag) && !(tag === 'Chama depois' && b.retornoAgendadoDaEquipe(item))) || (Boolean(item.continuationRequest) && tag === 'Não respondeu'));

const continuacaoArquivada = (item, consultas) => Boolean(item.continuationRequest && (pedidoDe(consultas.find((c) => c.id === item.continuationRequest.sourceConsultationId) || {}) || {}).archived);
const avancoDeFilaPendente = (item, consultas) => Boolean(item.continuationRequest && (pedidoDe(consultas.find((c) => c.id === item.continuationRequest.sourceConsultationId) || {}) || {}).queueAdvance);

function continuacaoSuspensa(item, consultas) {
  if (!item.continuationRequest) return false;
  const pedido = pedidoDe(consultas.find((c) => c.id === item.continuationRequest.sourceConsultationId) || {});
  if (pedido && (pedido.archived || pedido.reservationRelease)) return true;
  const tags = contatoDe(item).tags;
  if (tags.some((tag) => RETORNOS.includes(tag))) return true;
  if (tags.includes('Pode agora')) return false;
  return Boolean(pedido && pedido.suspended);
}

const solicitadoEm = (c) => (pedidoDe(c) && pedidoDe(c).requestedAt) || (c.tarologistFinishReport && c.tarologistFinishReport.submittedAt) || c.updatedAt;
function pedidosAbertos(consultas) {
  return consultas.filter((c) => ESTADOS_COM_PEDIDO.includes(c.status) && pedidoDeMaisTempo(c) && !(pedidoDe(c) && pedidoDe(c).archived) && !b.filhaDaContinuacao(c, consultas))
    .sort((p, q) => Date.parse(solicitadoEm(p)) - Date.parse(solicitadoEm(q)));
}

/** `hydrateMoreTimeAgendaContact`: traz os controles antigos do pedido para o histórico da agenda (uma vez). */
function hidratarContato(item, origem) {
  const pedido = pedidoDe(origem);
  if (!pedido || pedido.agendaFollowUp) return item;
  const eventos = [];
  if (pedido.notified) eventos.push({ tag: 'Avisada', ...pedido.notified });
  if (pedido.noResponse) eventos.push({ tag: 'Não respondeu', ...pedido.noResponse });
  if (pedido.suspended && RETORNOS.includes(pedido.suspended.tag)) eventos.push({ ...pedido.suspended, tag: pedido.suspended.tag });
  let proximo = item;
  for (const evento of eventos.sort((p, q) => Date.parse(p.at) - Date.parse(q.at))) {
    const id = `more-time-contact-${origem.id}-${evento.tag}-${evento.at}`;
    if (!Number.isFinite(Date.parse(evento.at)) || (proximo.contactHistory || []).some((r) => r.id === id)) continue;
    if ((proximo.contactHistory || []).some((r) => !`${r.id}`.startsWith('continue-') && Date.parse(r.at) > Date.parse(evento.at))) continue;
    proximo = alternarEtiqueta(proximo, evento.tag, evento.by, evento.at, t.diaOperacionalDe(Date.parse(evento.at)), false, id, 'activate');
  }
  return proximo;
}

/** `agendaItemForMoreTime`: o agendamento (real ou virtual, nunca gravado) do pedido de mais tempo. */
function agendaDoMaisTempo(origem, agenda, agora) {
  if (!pedidoDeMaisTempo(origem) || !ESTADOS_COM_PEDIDO.includes(origem.status)) return null;
  const ligados = agenda.filter((r) => (r.continuationRequest && r.continuationRequest.sourceConsultationId === origem.id) || (r.formerContinuationRequest && r.formerContinuationRequest.sourceConsultationId === origem.id));
  if (ligados.length) {
    const item = ligados[0];
    if (ligados.length !== 1 || !item.continuationRequest || item.clientId !== origem.clientId || item.tarotId !== origem.tarotId) return null;
    return hidratarContato(item, origem);
  }
  const id = `continue-${origem.id}`;
  if (agenda.some((r) => r.id === id)) return null;
  const pedidoEm = solicitadoEm(origem); const marca = Date.parse(pedidoEm);
  if (!Number.isFinite(marca) || !Number.isFinite(agora)) return null;
  const data = t.diaOperacionalDe(marca);
  const por = (pedidoDe(origem) && pedidoDe(origem).reporterName) || (origem.tarologistFinishReport && origem.tarologistFinishReport.reporterName) || origem.tarot;
  const item = { id, clientId: origem.clientId, client: origem.client, tarotId: origem.tarotId, channel: origem.channel, date: data, ...(origem.demoDate ? { demoDate: origem.demoDate } : {}),
    time: t.relogioSP(marca), createdAt: pedidoEm, createdBy: por, position: 0, observation: 'Cliente quer continuar a consulta.', response: 'Aguardando resposta',
    continuationRequest: { sourceConsultationId: origem.id, requestedAt: pedidoEm, requestedBy: por }, contact: { date: data, attempt: 1, tags: [] },
    ...(pedidoDe(origem) && pedidoDe(origem).agendaFollowUp) };
  return hidratarContato(item, origem);
}

/** `panelContinuationReservation`. */
function reservaDeContinuacao(origem, entrada) {
  const pedido = pedidoDe(origem);
  if (!ESTADOS_COM_PEDIDO.includes(origem.status) || !pedidoDeMaisTempo(origem) || (pedido && (pedido.archived || pedido.suspended || pedido.released || pedido.reservationRelease || pedido.queueAdvance)) || b.filhaDaContinuacao(origem, entrada.consultations)) return undefined;
  const item = agendaDoMaisTempo(origem, entrada.agenda, entrada.now);
  if (!item || encerrado(item) || item.workflowStatus === 'Em consulta' || contatoParado(item) || b.recessoComum(item) || continuacaoSuspensa(item, entrada.consultations)) return undefined;
  return { source: origem, item };
}

/** `panelContinuationReservations`: uma por taróloga (a reserva canônica da sessão concluída primeiro). */
function reservasDeContinuacao(entrada) {
  const candidatas = pedidosAbertos(entrada.consultations).flatMap((origem) => { const r = reservaDeContinuacao(origem, entrada); return r ? [r] : []; });
  const escolhidas = new Map();
  for (const c of candidatas) {
    const anterior = escolhidas.get(c.source.tarotId);
    const conflito = b.conflitoDeContinuacao(entrada.consultations, c.source.tarotId);
    if (!anterior || (conflito && conflito.id === c.source.id)) escolhidas.set(c.source.tarotId, c);
  }
  return [...escolhidas.values()];
}

module.exports = { ETAPAS_DE_PARADA, pedidoDeMaisTempo, contatoParado, continuacaoArquivada, avancoDeFilaPendente, continuacaoSuspensa, solicitadoEm, pedidosAbertos, hidratarContato, agendaDoMaisTempo, reservaDeContinuacao, reservasDeContinuacao };
