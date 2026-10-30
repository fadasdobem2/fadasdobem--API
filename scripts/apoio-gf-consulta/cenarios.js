'use strict';

/**
 * Cenários do ouro da Consulta: entradas puras (JSON), usadas pelo gerador (que as roda no CÓDIGO REAL do front) e pelo verificador
 * (que as roda no porte da API). Cada cenário tem `tipo`, `nome` e a entrada; o resultado esperado vem de `ouro-consulta-front.json`.
 * Instantes fixos no dia 10/11/2026 (UTC-3), todos em ISO com Z.
 */

const T = (min) => new Date(Date.parse('2026-11-10T14:00:00.000Z') + min * 60000).toISOString();

const base = (extra = {}) => ({
  id: 'c1', clientId: '900013', client: 'Cliente Teste', tarotId: 'osiris', tarot: 'Osiris', startedAt: T(0), sentToTarologistAt: T(0), durationSeconds: 0,
  awaitingTarologistStart: true, paymentProfile: 'Pós-paga', channel: 'WhatsApp Áudio', attendant: 'Khloe', observation: '', status: 'Em curso', updatedAt: T(0), audit: [],
  commissionRate: 30, timeLimit: { kind: 'maximum', minutes: 30 }, expectedMinutes: 30, ...extra,
});
/** Iniciada pela taróloga aos 2 min. */
const iniciada = (extra = {}) => base({ awaitingTarologistStart: false, tarologistStartedAt: T(2), startedAt: T(2), ...extra });
const outra = (extra = {}) => base({ id: 'c2', clientId: '900014', tarotId: 'nyx', tarot: 'Nyx', ...extra });
const pausa = (ini, fim) => ({ id: `pause-c1-${ini}`, startedAt: ini, startedBy: 'Osiris', reason: 'Taróloga pediu tempo', awaitingStart: false, ...(fim ? { endedAt: fim, endedBy: 'Osiris', endReason: 'resumed' } : {}) });

const CENARIOS = [
  // Início
  { tipo: 'iniciar', nome: 'início pela taróloga dona', item: base(), tarotId: 'osiris', ator: 'Osiris', agora: T(2), outras: [] },
  { tipo: 'iniciar', nome: 'início recusado: outro tarólogo', item: base(), tarotId: 'nyx', ator: 'Nyx', agora: T(2), outras: [] },
  { tipo: 'iniciar', nome: 'início recusado: já iniciada', item: iniciada(), tarotId: 'osiris', ator: 'Osiris', agora: T(5), outras: [] },
  { tipo: 'iniciar', nome: 'início recusado: ocupada por outra aberta da mesma cliente', item: base(), tarotId: 'osiris', ator: 'Osiris', agora: T(2), outras: [base({ id: 'c9', tarotId: 'nyx', tarot: 'Nyx' })] },
  { tipo: 'iniciar', nome: 'início recusado: antes do envio', item: base({ sentToTarologistAt: T(10) }), tarotId: 'osiris', ator: 'Osiris', agora: T(2), outras: [] },
  { tipo: 'iniciar', nome: 'início com aprovação de lançamento simultâneo', item: base({ occupancyOverride: { clientId: '900013', tarotId: 'osiris', consultationIds: ['c9'], by: 'Khloe', at: T(0) } }), tarotId: 'osiris', ator: 'Osiris', agora: T(2), outras: [base({ id: 'c9', tarotId: 'nyx', tarot: 'Nyx' })] },
  { tipo: 'iniciar', nome: 'início fecha a pausa aberta', item: base({ pauseHistory: [pausa(T(1))] }), tarotId: 'osiris', ator: 'Osiris', agora: T(3), outras: [] },
  { tipo: 'iniciar-equipe', nome: 'início pela equipe', item: base(), tarotId: 'osiris', ator: 'Khloe', agora: T(3), outras: [] },
  // Pausa e retomada
  { tipo: 'pausar', nome: 'pausa da equipe (aguardando)', item: base(), ator: 'Khloe', agora: T(1), perfil: 'atendente' },
  { tipo: 'pausar', nome: 'pausa da taróloga dona aguardando', item: base(), ator: 'Osiris', agora: T(1), perfil: 'tarologa', tarotIdProprio: 'osiris' },
  { tipo: 'pausar', nome: 'pausa recusada: taróloga com consulta iniciada', item: iniciada(), ator: 'Osiris', agora: T(5), perfil: 'tarologa', tarotIdProprio: 'osiris' },
  { tipo: 'pausar', nome: 'pausa recusada: taróloga de outro perfil', item: base(), ator: 'Nyx', agora: T(1), perfil: 'tarologa', tarotIdProprio: 'nyx' },
  { tipo: 'pausar', nome: 'pausa repetida devolve igual', item: base({ pauseHistory: [pausa(T(1))] }), ator: 'Khloe', agora: T(2), perfil: 'atendente' },
  { tipo: 'pausar', nome: 'pausa recusada: já encerrada', item: base({ status: 'Concluída' }), ator: 'Khloe', agora: T(2), perfil: 'atendente' },
  { tipo: 'retomar', nome: 'retomada fecha a pausa', item: base({ pauseHistory: [pausa(T(1))] }), ator: 'Khloe', agora: T(4) },
  { tipo: 'retomar', nome: 'retomada sem pausa devolve igual', item: base(), ator: 'Khloe', agora: T(4) },
  // Término informado
  { tipo: 'termino', nome: 'término dentro do limite com motivo (antecipado)', item: iniciada(), minutos: 20, tarotId: 'osiris', ator: 'Osiris', agora: T(22), opcoes: {}, antecipado: { reason: 'client_satisfied', note: '' } },
  { tipo: 'termino', nome: 'término no limite exato', item: iniciada({ tarologistStartedAt: T(2), startedAt: T(2) }), minutos: 30, tarotId: 'osiris', ator: 'Osiris', agora: T(33), opcoes: {} },
  { tipo: 'termino', nome: 'término acima do máximo (corta e vai à conferência)', item: iniciada(), minutos: 35, tarotId: 'osiris', ator: 'Osiris', agora: T(40), opcoes: { timingConfirmed: true } },
  { tipo: 'termino', nome: 'término recusado: maior que o intervalo sem confirmar', item: iniciada(), minutos: 25, tarotId: 'osiris', ator: 'Osiris', agora: T(12), opcoes: {} },
  { tipo: 'termino', nome: 'término com confirmação do tempo', item: iniciada(), minutos: 25, tarotId: 'osiris', ator: 'Osiris', agora: T(12), opcoes: { timingConfirmed: true }, antecipado: { note: 'cliente saiu' } },
  { tipo: 'termino', nome: 'término recusado: antecipado sem motivo', item: iniciada(), minutos: 10, tarotId: 'osiris', ator: 'Osiris', agora: T(14), opcoes: {} },
  { tipo: 'termino', nome: 'término recusado: aguardando início', item: base(), minutos: 10, tarotId: 'osiris', ator: 'Osiris', agora: T(14), opcoes: {} },
  { tipo: 'termino', nome: 'término recusado: já encerrada uma vez', item: iniciada({ tarologistFinishReport: { minutes: 30, endedAt: T(32), submittedAt: T(32), reporterTarotId: 'osiris', reporterName: 'Osiris', reporterRole: 'tarologo' } }), minutos: 30, tarotId: 'osiris', ator: 'Osiris', agora: T(40), opcoes: {} },
  { tipo: 'termino', nome: 'término recusado: outra taróloga', item: iniciada(), minutos: 20, tarotId: 'nyx', ator: 'Nyx', agora: T(25), opcoes: {} },
  { tipo: 'termino', nome: 'término recusado: minutos zero', item: iniciada(), minutos: 0, tarotId: 'osiris', ator: 'Osiris', agora: T(25), opcoes: {} },
  { tipo: 'termino', nome: 'término com horários informados (clock)', item: iniciada(), minutos: 30, tarotId: 'osiris', ator: 'Osiris', agora: T(34), opcoes: { timeEntry: { mode: 'clock', startTime: '11:02', endTime: '11:32', nextDay: false } } },
  { tipo: 'termino', nome: 'término recusado: horários não batem', item: iniciada(), minutos: 20, tarotId: 'osiris', ator: 'Osiris', agora: T(34), opcoes: { timeEntry: { mode: 'clock', startTime: '11:02', endTime: '11:32', nextDay: false } } },
  { tipo: 'termino', nome: 'término com pausa no meio', item: iniciada({ pauseHistory: [pausa(T(10), T(15))] }), minutos: 25, tarotId: 'osiris', ator: 'Osiris', agora: T(34), opcoes: {}, antecipado: { reason: 'client_connection', note: '' } },
  { tipo: 'termino', nome: 'término pós-paga tempo livre', item: iniciada({ paymentProfile: 'Pós-paga', timeLimit: { kind: 'free' }, expectedMinutes: undefined }), minutos: 45, tarotId: 'osiris', ator: 'Osiris', agora: T(50), opcoes: {} },
  { tipo: 'termino', nome: 'término mantém pedido de mais tempo', item: iniciada({ tarologistMoreTimeRequest: { active: true, requestedAt: T(20), reporterTarotId: 'osiris', reporterName: 'Osiris' } }), minutos: 30, tarotId: 'osiris', ator: 'Osiris', agora: T(33), opcoes: {} },
  { tipo: 'termino-equipe', nome: 'término pela equipe', item: iniciada(), minutos: 15, ator: 'Khloe', agora: T(20) },
  { tipo: 'mais-tempo', nome: 'pedido de mais tempo', item: iniciada(), tarotId: 'osiris', ator: 'Osiris', agora: T(20) },
  { tipo: 'mais-tempo', nome: 'pedido de mais tempo recusado: aguardando início', item: base(), tarotId: 'osiris', ator: 'Osiris', agora: T(20) },
  { tipo: 'mais-tempo', nome: 'pedido de mais tempo repetido devolve igual', item: iniciada({ tarologistMoreTimeRequest: { active: true, requestedAt: T(10), reporterTarotId: 'osiris', reporterName: 'Osiris' } }), tarotId: 'osiris', ator: 'Osiris', agora: T(20) },
  // Devolução e correção pedidas pela taróloga
  { tipo: 'devolver', nome: 'devolução da taróloga com consulta em andamento', item: iniciada({ durationSeconds: 125, observation: 'nota' }), entrada: { reason: 'Não bateu', note: 'sem sinal' }, tarotId: 'osiris', ator: 'Osiris', agora: T(5) },
  { tipo: 'devolver', nome: 'devolução da taróloga aguardando início zera o tempo', item: base({ durationSeconds: 77 }), entrada: { reason: 'Outros', note: '' }, tarotId: 'osiris', ator: 'Osiris', agora: T(5) },
  { tipo: 'devolver', nome: 'devolução retira o pedido de mais tempo', item: iniciada({ durationSeconds: 300, tarologistMoreTimeRequest: { active: true, requestedAt: T(4), reporterTarotId: 'osiris', reporterName: 'Osiris' } }), entrada: { reason: 'Prefiro não atender', note: 'x' }, tarotId: 'osiris', ator: 'Osiris', agora: T(8) },
  { tipo: 'devolver', nome: 'devolução recusada: motivo fora da lista', item: iniciada(), entrada: { reason: 'Qualquer', note: '' }, tarotId: 'osiris', ator: 'Osiris', agora: T(5) },
  { tipo: 'devolver', nome: 'devolução recusada: outra taróloga', item: iniciada(), entrada: { reason: 'Outros', note: '' }, tarotId: 'nyx', ator: 'Nyx', agora: T(5) },
  { tipo: 'devolver', nome: 'devolução recusada: já encerrada', item: iniciada({ status: 'Concluída' }), entrada: { reason: 'Outros', note: '' }, tarotId: 'osiris', ator: 'Osiris', agora: T(5) },
  { tipo: 'correcao', nome: 'pedido de correção do término', item: iniciada({ status: 'Concluída', durationSeconds: 1800, performedDurationSeconds: 1800, tarologistFinishReport: { minutes: 30, endedAt: T(32), submittedAt: T(32), reporterTarotId: 'osiris', reporterName: 'Osiris', reporterRole: 'tarologo' } }), minutos: 25, motivo: 'Errei a conta', tarotId: 'osiris', ator: 'Osiris', agora: T(40) },
  { tipo: 'correcao', nome: 'correção recusada: igual ao registrado', item: iniciada({ status: 'Concluída', durationSeconds: 1800, performedDurationSeconds: 1800, tarologistFinishReport: { minutes: 30, endedAt: T(32), submittedAt: T(32), reporterTarotId: 'osiris', reporterName: 'Osiris', reporterRole: 'tarologo' } }), minutos: 30, motivo: 'x', tarotId: 'osiris', ator: 'Osiris', agora: T(40) },
  { tipo: 'correcao', nome: 'correção recusada: consulta ainda em curso', item: iniciada(), minutos: 25, motivo: 'x', tarotId: 'osiris', ator: 'Osiris', agora: T(40) },
  { tipo: 'correcao', nome: 'correção recusada: sem motivo', item: iniciada({ status: 'Concluída', durationSeconds: 1800, tarologistFinishReport: { minutes: 30, endedAt: T(32), submittedAt: T(32), reporterTarotId: 'osiris', reporterName: 'Osiris', reporterRole: 'tarologo' } }), minutos: 25, motivo: '  ', tarotId: 'osiris', ator: 'Osiris', agora: T(40) },
  // Comissão, limite, relógio
  { tipo: 'comissao', nome: 'comissão padrão sem perfil', taxa: undefined, origem: undefined },
  { tipo: 'comissao', nome: 'comissão do perfil 35', taxa: 35, origem: undefined },
  { tipo: 'comissao', nome: 'comissão fora do intervalo cai no padrão', taxa: 150, origem: undefined },
  { tipo: 'comissao', nome: 'continuação herda a da origem', taxa: 40, origem: { commissionRate: 25 } },
  { tipo: 'comissao', nome: 'continuação de origem sem taxa herda 30', taxa: 40, origem: {} },
  { tipo: 'limite', nome: 'pré-paga com 20 min', minutos: 20, perfil: 'Pré-paga' },
  { tipo: 'limite', nome: 'pré-paga sem tempo recusa', minutos: undefined, perfil: 'Pré-paga' },
  { tipo: 'limite', nome: 'pós-paga sem tempo é livre', minutos: undefined, perfil: 'Pós-paga' },
  { tipo: 'limite', nome: 'pós-paga com fração recusa', minutos: 12.5, perfil: 'Pós-paga' },
  { tipo: 'relogio', nome: 'duração em 30 min corridos', item: iniciada(), agora: T(32) },
  { tipo: 'relogio', nome: 'duração descontando a pausa', item: iniciada({ pauseHistory: [pausa(T(10), T(15))] }), agora: T(32) },
  { tipo: 'relogio', nome: 'duração parada durante a pausa', item: iniciada({ pauseHistory: [pausa(T(10))], durationSeconds: 480 }), agora: T(32) },
  { tipo: 'relogio', nome: 'duração de quem aguarda é zero', item: base(), agora: T(32) },
  // Agenda que nasce da consulta
  { tipo: 'agenda-inicio', nome: 'agenda resolvida pela consulta iniciada', agenda: agendaBase(), visita: iniciada({ agendaItemId: 'ag-1' }), agora: T(3) },
  { tipo: 'agenda-inicio', nome: 'agenda de outra cliente não é tocada', agenda: agendaBase({ clientId: '900099' }), visita: iniciada({ agendaItemId: 'ag-1' }), agora: T(3) },
  { tipo: 'agenda-inicio', nome: 'agenda sem aviso prévio', agenda: agendaBase({ contact: { attempt: 2, date: '2026-11-10', tags: ['Pode agora'] } }), visita: iniciada({ agendaItemId: 'ag-1' }), agora: T(3) },
  { tipo: 'agenda-inicio', nome: 'consulta ainda aguardando início não resolve', agenda: agendaBase(), visita: base({ agendaItemId: 'ag-1' }), agora: T(3) },
  { tipo: 'agenda-fim', nome: 'agenda conclui quando a consulta termina', agenda: agendaBase({ resolvedByConsultationId: 'c1', resolvedAt: T(3), workflowStatus: 'Em consulta', contact: { attempt: 1, date: '2026-11-10', tags: ['Em consulta'] } }), visita: iniciada({ agendaItemId: 'ag-1', status: 'Concluída', endedAt: T(32), durationSeconds: 1800, tarologistFinishReport: { minutes: 30, endedAt: T(32), submittedAt: T(32), reporterTarotId: 'osiris', reporterName: 'Osiris', reporterRole: 'tarologo' } }), agora: T(33) },
];

function agendaBase(extra = {}) {
  return { id: 'ag-1', publicNumber: 1, tarotId: 'osiris', clientId: '900013', client: 'Cliente Teste', date: '2026-11-10', time: '10:00', channel: 'WhatsApp Áudio', position: 1,
    response: 'Aguardando resposta', paymentPending: false, createdAt: T(-120), createdBy: 'Khloe', contact: { attempt: 1, date: '2026-11-10', tags: ['Avisada'] }, ...extra };
}

module.exports = { CENARIOS, T, base, iniciada };
