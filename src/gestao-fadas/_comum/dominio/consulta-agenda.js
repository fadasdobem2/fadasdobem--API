'use strict';

/**
 * A agenda que NASCE da consulta (pendência (c) de Presença e Agenda; contrato 28 seção 2.3): quando a consulta lançada leva um
 * `agendaItemId` e a taróloga a inicia, o agendamento é retirado da fila como "Agendamento concluído" e fica "Em consulta"; quando a
 * consulta termina, vira "Concluída". Porte do caminho EXPLÍCITO (vínculo declarado) de `agenda/agenda-consultation-resolution.ts`
 * (`resolveAgendaWithConsultation`, o trecho de `reconcileAttendedAgenda` que fecha o item que já resolveu uma consulta) e do ramo
 * "Em consulta" / "Concluída" de `toggleAgendaTag` (agenda-contact.ts:137-205). A inferência sem vínculo (mesma cliente e dia, sem
 * `agendaItemId`) NÃO é portada: o front real desliga a conciliação local e o servidor só resolve o que foi vinculado de propósito.
 * Sem banco, sem Express; o servidor aplica o resultado em `gf_agenda` na mesma transação da consulta.
 */

const { contatoDe, encerrado } = require('./agenda-contato');
const { hojeOperacional } = require('../dia-operacional');
const c = require('./consulta-comum');

const horaSP = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const inicioDe = (v) => v.tarologistStartedAt || v.startedAt;
const correndo = (v) => v.status === 'Em curso' && !v.tarologistFinishReport;

/** `consultationHasActuallyStarted` (agenda-consultation-resolution.ts:13). */
function iniciouDeVerdade(v, agoraMs) {
  const inicio = Date.parse(inicioDe(v));
  if (!c.CONSOMEM_COBERTURA.has(v.status) || v.awaitingTarologistStart || !Number.isFinite(inicio) || inicio > agoraMs || !Number.isFinite(v.durationSeconds) || v.durationSeconds < 0) return false;
  if (correndo(v)) return true;
  const fim = Date.parse(v.endedAt || (v.tarologistFinishReport && v.tarologistFinishReport.submittedAt) || '');
  return Number.isFinite(fim) && fim >= inicio && fim <= agoraMs;
}

/** `agendaResolutionDetail` (agenda-consultation-resolution.ts:42). */
const detalhe = (v, automatico) => `Agendamento atendido pela consulta ${v.id}, iniciada às ${horaSP.format(new Date(inicioDe(v)))} com ${v.tarot}. ${automatico ? 'Retirado automaticamente' : 'Retirado'} da fila de espera.${correndo(v) ? ' A consulta continua em andamento.' : ''}`;

/** Ramo "Em consulta" / "Concluída" de `toggleAgendaTag` com `intent: activate` e `allowOutcome` (agenda-contact.ts:178-205). */
function ativarEtapa(item, etiqueta, ator, em, data, idEvento) {
  const atual = contatoDe(item);
  const tags = [...atual.tags.filter((t) => t === 'Avisada'), etiqueta];
  const desfecho = tags.includes('Concluída') ? 'Concluída' : undefined;
  const semAdiamento = item.queueDeferral
    ? { ...item, queueDeferral: undefined, queueDeferralHistory: [...(item.queueDeferralHistory || []), { ...item.queueDeferral, at: em, by: ator, active: false }] }
    : item;
  return {
    // A reserva da fila geral some quando a consulta nasce (`assignQueueConsultation`, panel-flow-model.ts:303: `queueReservation: undefined`).
    ...semAdiamento, ...(tags.includes('Em consulta') ? { queueReservation: undefined } : {}), contact: { attempt: atual.attempt, date: data, tags },
    workflowStatus: tags.includes('Em consulta') ? 'Em consulta' : desfecho === 'Concluída' ? 'Concluída' : tags.includes('Avisada') ? 'Avisada' : undefined,
    response: tags.includes('Não respondeu') ? 'Não respondeu' : 'Aguardando resposta',
    agendaOutcome: desfecho, resolvedAt: desfecho ? em : undefined,
    resolvedByConsultationId: desfecho === 'Concluída' ? item.resolvedByConsultationId : undefined,
    contactHistory: [...(item.contactHistory || []), { id: idEvento, actor: ator, at: em, date: data, attempt: atual.attempt, tag: etiqueta, active: true, before: atual.tags, after: tags }],
  };
}

/** `resolveAgendaWithConsultation` (agenda-consultation-resolution.ts:50), vínculo explícito. Devolve o mesmo item se não se aplica. */
function resolverAgenda(item, visita, ator, em, automatico = true) {
  if (encerrado(item) || item.clientId !== visita.clientId || (item.continuationRequest && item.continuationRequest.sourceConsultationId === visita.id)
    || (item.formerContinuationRequest && item.formerContinuationRequest.sourceConsultationId === visita.id) || !iniciouDeVerdade(visita, Date.parse(em))) return item;
  const id = `agenda-resolution-${item.id}-${visita.id}`;
  const data = hojeOperacional(new Date(visita.startedAt));
  const proximo = ativarEtapa(item, correndo(visita) ? 'Em consulta' : 'Concluída', ator, em, data, `${id}-contact`);
  return { ...proximo, resolvedByConsultationId: visita.id, resolvedAt: em,
    resolutionHistory: [...(item.resolutionHistory || []), { id, action: 'Agendamento concluído', consultationId: visita.id, actor: ator, createdAt: em, detail: detalhe(visita, automatico) }] };
}

/** Item que já resolveu uma consulta que acabou: sai de "Em consulta" e vira "Concluída" (reconcileAttendedAgenda, 1º laço). */
function concluirAgenda(item, visita, em) {
  if (!item.resolvedByConsultationId || item.agendaOutcome || item.workflowStatus !== 'Em consulta' || correndo(visita) || !iniciouDeVerdade(visita, Date.parse(em))) return item;
  const concluido = ativarEtapa(item, 'Concluída', 'Sistema', em, hojeOperacional(new Date(visita.startedAt)), `agenda-resolution-finish-${item.id}-${visita.id}`);
  return { ...concluido, resolvedAt: item.resolvedAt };
}

module.exports = { iniciouDeVerdade, resolverAgenda, concluirAgenda, detalhe };
