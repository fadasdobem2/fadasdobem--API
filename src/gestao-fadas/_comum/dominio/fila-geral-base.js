'use strict';

/**
 * Fila geral, parte 1 (domínio puro): estado de espera, prazos comuns lidos do histórico, correspondência com consultas e conflito de
 * continuação. Porte versionado do CÓDIGO do front do suspiro (Maturacao/29 seção 11), arquivo:linha de cada função:
 *   general-queue-state.ts, agenda-deferral.ts:4, common-deadline-history.ts, agenda-common-deadlines.ts:67-75 (`commonAgendaRecession`),
 *   queue-timing.ts:6-47 (horário pedido, plano de contato), domain/agenda-matching.ts, agenda/reader-continuation.ts:34-41.
 * O calendário de demonstração (`DEMO_CALENDAR`) não existe no servidor: `agendaRequestedInstant` é o instante real.
 * Se o front mudar a regra, regerar o ouro (`scripts/gerar-ouro-gf-fila-geral.js`).
 */

const { contatoDe, encerrado } = require('./agenda-contato');
const { diaOperacionalDe } = require('./painel-tempo');
const { consomeCobertura } = require('./financeiro-base');
const { relogio } = require('./agenda-regras');

const FILA_GERAL = 'afila';

const diaOperacional = (instante) => diaOperacionalDe(new Date(instante).getTime());

// agenda-deferral.ts:4
const temEsperaAdiada = (item) => Boolean(item.queueDeferral && item.queueDeferral.attempt === ((item.contact && item.contact.attempt) ?? 1));

// queue-timing.ts:8-18: só um relógio sem ambiguidade ordena a fila; texto livre é nota.
function horarioPedido(item, dataReserva) {
  const plano = item.contactPlan;
  const bruto = plano ? (plano.timing === 'none' ? '' : plano.timing === 'shift' ? ((plano.shift && plano.shift.start) ?? '') : (plano.time ?? '')) : (item.scheduledTime || (item.requestedTime || '').trim() || '');
  const m = `${bruto}`.match(/^(\d{1,2})(?::|h)(\d{2})?$/i);
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2] || 0);
  if (h > 23 || mi > 59) return null;
  const data = item.date || dataReserva;
  const em = Date.parse(`${data}T${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00-03:00`);
  return Number.isFinite(em) ? em + (h < 6 ? 86400000 : 0) : null;
}
const instantePedido = horarioPedido; // sem calendário de demonstração, o instante real é o próprio horário

// queue-timing.ts:30-37
function turnoEncerrado(item, dataRef, agora) {
  const plano = item.contactPlan;
  if (!plano || plano.timing !== 'shift' || !plano.shift) return false;
  const inicio = horarioPedido(item, dataRef);
  if (inicio === null) return false;
  const min = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
  const duracao = (min(plano.shift.end) - min(plano.shift.start) + 1440) % 1440;
  return agora >= inicio + duracao * 60000;
}
// queue-timing.ts:39-44
function planoPermiteContato(item, dataRef, agora) {
  if (item.contactPlan && item.contactPlan.who === 'client') return false;
  if ((item.date ?? dataRef) > dataRef) return false;
  const inicio = instantePedido(item, dataRef);
  return (inicio === null || inicio <= agora) && !turnoEncerrado(item, dataRef, agora);
}

// agenda-contact-plan.ts:44-67 (`hasScheduledStaffCallback`)
function retornoAgendadoDaEquipe(item) {
  const tentativa = (item.contact && item.contact.attempt) ?? 1;
  const chamaDepois = (item.contactHistory || []).filter((e) => e.tag === 'Chama depois' && e.attempt === tentativa).at(-1);
  if (item.contactReturn && item.contactReturn.attempt === tentativa && chamaDepois && chamaDepois.id === item.contactReturn.afterEventId) return false;
  const plano = item.contactPlan;
  if (!plano || plano.who !== 'staff' || !plano.callback) return false;
  const relogioValido = (v) => relogio(`${v ?? ''}`) !== null;
  const comHora = ['exact', 'approximate', 'after'].includes(plano.timing) && relogioValido(plano.time);
  const turno = plano.timing === 'shift' && Boolean(relogioValido(plano.shift && plano.shift.start) && relogioValido(plano.shift && plano.shift.end) && plano.shift.start !== plano.shift.end);
  if (!comHora && !turno) return false;
  const retorno = (item.contactHistory || []).filter((e) => e.attempt === tentativa && e.tag === 'Chama depois' && e.active).at(-1);
  const registrado = Date.parse((retorno && retorno.at) ?? '');
  if (!retorno || !Number.isFinite(registrado)) return true;
  if (turno) return !turnoEncerrado(item, retorno.date, registrado);
  if (plano.timing === 'after') return true;
  const pedido = instantePedido(item, retorno.date);
  return pedido !== null && registrado < pedido;
}

// general-queue-state.ts
const ETIQUETAS_RETORNO = new Set(['Não pode agora', 'Não pode', 'Chama depois', 'Cliente vai chamar', 'Não voltou', 'Próximo turno']);
const ehEtiquetaDeRetorno = (tag) => ETIQUETAS_RETORNO.has(tag);
const temEstadoDeRetorno = (item) => temEsperaAdiada(item) || contatoDe(item).tags.some((tag) => ehEtiquetaDeRetorno(tag)
  && !(tag === 'Chama depois' && retornoAgendadoDaEquipe(item))
  && !(tag === 'Cliente vai chamar' && item.contactPlan && item.contactPlan.who === 'client' && !item.contactPlan.callback));
const ehEtiquetaQueLiberaReserva = (tag) => ehEtiquetaDeRetorno(tag) || tag === 'Não respondeu';

// common-deadline-history.ts
const idDeTempoEsgotado = (item) => `common-call-timeout-${item.id}-`;
const eventoDeTempoEsgotado = (item, tentativa) => (item.contactHistory || []).filter((e) => e.attempt === tentativa && e.active && `${e.id || ''}`.startsWith(idDeTempoEsgotado(item)) && ['Não respondeu', 'Não voltou'].includes(e.tag)).at(-1);
function reservaJaExpirou(item) {
  const reservadoEm = Date.parse((item.queueReservation && item.queueReservation.at) ?? '');
  return Boolean(item.queueReservation) && Number.isFinite(reservadoEm) && Boolean((item.contactHistory || []).some((e) => e.active && `${e.id || ''}`.startsWith(idDeTempoEsgotado(item))
    && ['Não respondeu', 'Não voltou'].includes(e.tag) && Date.parse(e.at) >= reservadoEm));
}
// agenda-common-deadlines.ts:67-75: leitura de eventos automáticos antigos; o servidor NUNCA os cria (reconcileCommonAgendaDeadlines devolve a agenda intacta)
function recessoComum(item) {
  const contato = contatoDe(item);
  const evento = eventoDeTempoEsgotado(item, contato.attempt);
  if (!evento || !contato.tags.includes(evento.tag) || (!item.continuationRequest && evento.tag === 'Não respondeu')) return undefined;
  return { label: evento.tag === 'Não voltou' ? 'Parou de responder' : 'Não respondeu', at: evento.at, lane: evento.before.includes('Pode agora') ? 'ready' : 'notified' };
}

// reader-continuation.ts:28-41 e tarologist-finish-report.ts:46
const pediuMaisTempo = (c) => (c.tarologistMoreTimeRequest && c.tarologistMoreTimeRequest.active) ?? (c.tarologistFinishReport && c.tarologistFinishReport.clientWantsMoreTime) ?? false;
const filhaDaContinuacao = (origem, consultas) => consultas.find((c) => c.clientId === origem.clientId && c.tarotId === origem.tarotId && consomeCobertura(c)
  && ((c.continuation && c.continuation.sourceConsultationId === origem.id) || (c.coverage && c.coverage.kind === 'Complemento' && c.coverage.sourceConsultationId === origem.id)));
/** O pedido inicial reserva a taróloga antes do contato ou do pagamento; só a própria continuação autorizada passa. */
function conflitoDeContinuacao(consultas, tarotId, origemAutorizadaId) {
  return consultas.find((c) => c.id !== origemAutorizadaId && c.tarotId === tarotId && ['Concluída', 'Finalizada pelo tarólogo'].includes(c.status) && pediuMaisTempo(c)
    && !(c.tarologistMoreTimeRequest && (c.tarologistMoreTimeRequest.suspended || c.tarologistMoreTimeRequest.reservationRelease || c.tarologistMoreTimeRequest.queueAdvance || c.tarologistMoreTimeRequest.archived))
    && !filhaDaContinuacao(c, consultas));
}

// agenda-matching.ts
const entradaNaAgenda = (item, dataPadrao) => (item.createdAt ? new Date(item.createdAt).getTime() : new Date(`${item.date || dataPadrao}T${item.time}:00-03:00`).getTime());
function consultasQueCasam(item, consultas, dataPadrao) {
  const dataAgenda = item.date || dataPadrao;
  const entrou = entradaNaAgenda(item, dataPadrao);
  const invalidadas = new Set((item.resolutionHistory || []).filter((e) => e.action === 'Correspondência invalidada').map((e) => e.consultationId));
  const mantidas = new Set();
  (item.resolutionHistory || []).forEach((e) => {
    if (e.action === 'Agendamento mantido') mantidas.add(e.consultationId);
    if (e.action === 'Agendamento editado' || e.action === 'Restaurada na agenda') mantidas.delete(e.consultationId);
  });
  const diaDe = (c) => (Number.isFinite(Date.parse(c.startedAt)) ? diaOperacional(c.startedAt) : '');
  return consultas
    .filter((c) => consomeCobertura(c) && c.clientId === item.clientId
      && (c.agendaItemId === item.id || diaDe(c) === dataAgenda || (dataAgenda < dataPadrao && diaDe(c) === dataPadrao))
      && new Date(c.startedAt).getTime() > entrou && !invalidadas.has(c.id))
    .sort((p, q) => (Number(mantidas.has(p.id)) - Number(mantidas.has(q.id)))
      || (Number(q.agendaItemId === item.id) - Number(p.agendaItemId === item.id))
      || (Number(q.tarotId === item.tarotId) - Number(p.tarotId === item.tarotId))
      || (new Date(q.startedAt).getTime() - new Date(p.startedAt).getTime()));
}
const correspondenciaMantida = (item, consulta) => (item.resolutionHistory || [])
  .filter((e) => e.consultationId === consulta.id && ['Agendamento mantido', 'Agendamento editado', 'Restaurada na agenda'].includes(e.action)).at(-1)?.action === 'Agendamento mantido';

module.exports = {
  FILA_GERAL, diaOperacional, temEsperaAdiada, horarioPedido, instantePedido, turnoEncerrado, planoPermiteContato, retornoAgendadoDaEquipe,
  ehEtiquetaDeRetorno, temEstadoDeRetorno, ehEtiquetaQueLiberaReserva, eventoDeTempoEsgotado, reservaJaExpirou, recessoComum,
  pediuMaisTempo, filhaDaContinuacao, conflitoDeContinuacao, consultasQueCasam, correspondenciaMantida, encerrado,
};
