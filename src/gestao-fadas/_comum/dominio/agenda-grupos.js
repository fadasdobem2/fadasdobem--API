'use strict';

/**
 * Quais campos do `AgendaItem` cada comando da Agenda pode mexer (tabela, sem lógica). O servidor é dono de `id`, `publicNumber`,
 * `createdAt`, `createdBy`, `position` nas fatias que não a movem, `orderCommand` e `positionOverrides` (estes dois só pelo comando
 * de ordem). Tudo o que o cliente manda fora do grupo da rota é recusado (D9 do contrato 28).
 *   - `set`: campos que o comando pode gravar; `unset`: os que pode apagar (`undefined` no front, que o JSON não leva);
 *   - `append`: histórias que só crescem (cada elemento tem `id`; o que já existe não muda).
 */

const CONTATO_CAMPOS = ['contact', 'contactPlan', 'workflowStatus', 'response', 'agendaOutcome', 'resolvedAt', 'resolvedByConsultationId', 'refundRequest',
  'queueDeferral', 'queueReservation', 'reservationClock', 'immediateReservationRelease', 'forwardedDate', 'forwardedAt', 'forwardedBy', 'standbyDate',
  'contactReturn', 'queuePaymentWait'];
const CONTATO_HISTORIAS = ['contactHistory', 'queueDeferralHistory', 'queueReservationHistory', 'forwardingHistory', 'contactReturnHistory',
  'manualNotices']; // v706: aviso de agenda declarado pela atendente (agenda-aviso-manual.js)

const AGENDAMENTO_CAMPOS = ['tarotId', 'clientId', 'client', 'channel', 'date', 'time', 'scheduledTime', 'requestedTime', 'paymentPending', 'paymentExpectedAmount',
  'paymentAmount', 'unlinkedPaymentAmount', 'requestedMinutes', 'requestId', 'referral', 'position', 'continuationRequest', 'formerContinuationRequest', 'dismissedConsultationIds'];

const GRUPOS = Object.freeze({
  contato: { set: CONTATO_CAMPOS, append: CONTATO_HISTORIAS, restaura: false },
  observacoes: { set: ['observation', 'observationFormatting', 'observations'], append: ['observationHistory'], restaura: false },
  prazo: { set: ['queuePaymentWait'], append: ['requestedWaitHistory'], restaura: false },
  saidas: { set: [...CONTATO_CAMPOS, 'tarotId', 'date', 'position'], append: [...CONTATO_HISTORIAS, 'departures', 'incidents', 'scheduleHistory'], restaura: true },
  resolucao: { set: [...CONTATO_CAMPOS, 'dismissedConsultationIds'], append: [...CONTATO_HISTORIAS, 'resolutionHistory', 'departures'], restaura: true },
  agendamento: {
    set: [...CONTATO_CAMPOS, ...AGENDAMENTO_CAMPOS, 'observation', 'observationFormatting', 'observations'],
    append: [...CONTATO_HISTORIAS, 'departures', 'incidents', 'scheduleHistory', 'resolutionHistory', 'observationHistory', 'requestedWaitHistory'],
    restaura: true,
    // Mudar de tarólogo ou de dia limpa a ordem manual do item: a posição nova vem do servidor e as sobreposições saem aqui.
    unset: ['positionOverrides'],
  },
});

/** Campos que o servidor monta ou que só o comando de ordem muda. */
// v706: `leadId`, `sourceLeadId` e `identityHistory` (cliente OU contato) só mudam pelo servidor (criação com contato e vínculo/desfazer do contato).
const RESERVADOS = Object.freeze(['id', 'publicNumber', 'createdAt', 'createdBy', 'orderCommand', 'positionOverrides', 'version', 'leadId', 'sourceLeadId', 'identityHistory']);

/** Histórias e o campo que carrega o NOME de quem agiu (o servidor o carimba com a sessão). */
const AUTOR_DA_HISTORIA = Object.freeze({
  contactHistory: 'actor', observationHistory: 'actor', departures: 'actor', incidents: 'actor', resolutionHistory: 'actor', scheduleHistory: 'actor',
  requestedWaitHistory: 'by', manualNotices: 'actorName', queueDeferralHistory: 'by', queueReservationHistory: 'by', forwardingHistory: 'by', contactReturnHistory: 'by',
});

/** Tipo do evento em `gf_agenda_eventos` por história. */
const TIPO_DO_EVENTO = Object.freeze({
  contactHistory: 'contato', manualNotices: 'contato', queueDeferralHistory: 'contato', queueReservationHistory: 'contato', forwardingHistory: 'contato', contactReturnHistory: 'contato',
  observationHistory: 'observacao', requestedWaitHistory: 'prazo', departures: 'saida', incidents: 'saida', resolutionHistory: 'resolucao', scheduleHistory: 'agendamento',
});

module.exports = { GRUPOS, RESERVADOS, AUTOR_DA_HISTORIA, TIPO_DO_EVENTO };
