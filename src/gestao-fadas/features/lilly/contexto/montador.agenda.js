'use strict';

/**
 * `appointments` do snapshot (Maturacao/59, 3.4; Maturacao/60, seção 7): a agenda `gf_agenda` no vocabulário da Lilly.
 *  - Quais: a fila ativa (abertos com data até o dia operacional de hoje), todos os abertos e os encerrados de hoje das clientes em foco, e o
 *    agendamento citado no evento. Mais que `AGENDA` = assunto incompleto (vazio).
 *  - `tarotId` -> `tarologistId` (a fila geral `afila` continua `afila`); `agendaOutcome` -> `status`
 *    (`Concluída` = completed, `Cancelada` = cancelled, aberto = scheduled); `posicao` -> `position`; dia operacional em `date`
 *    (`standbyDate` à parte: standby não entra na fila do dia).
 *  - SEM FONTE: `amount` ("só vira valor quando houver fonte real confirmada", Maturacao/60 §3), `notePresent`, `confirmed`, `conversationId`.
 *    Observação (texto livre) nunca sai.
 */

const { LIMITES } = require('./contexto.limites');
const { LimiteExcedido } = require('./contexto.cobertura');
const { instanteOperacional } = require('./contexto.tempo');

const STATUS = Object.freeze({ Concluída: 'completed', Cancelada: 'cancelled' });
const sem = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const item = (linha) => (typeof linha.item === 'string' ? JSON.parse(linha.item) : linha.item || {});
const dia = (v) => (v ? `${v}`.slice(0, 10) : undefined);
const iso = (v) => (v ? new Date(v).toISOString() : undefined);

function planoDeContato(plano) {
  if (!plano || typeof plano !== 'object') return undefined;
  const { who, timing, shift, time, callback } = plano;
  return sem({ who, timing, time, callback, shift: shift && typeof shift === 'object' ? sem({ start: shift.start, end: shift.end }) : undefined });
}

function linhaParaAgendamento(l) {
  const i = item(l);
  const data = dia(i.date);
  const hora = typeof i.scheduledTime === 'string' && /^\d{1,2}:\d{2}$/.test(i.scheduledTime) ? i.scheduledTime.padStart(5, '0') : undefined;
  return sem({
    id: l.id,
    clientId: l.id_cliente,
    tarologistId: l.id_tarologo,
    status: STATUS[l.agenda_outcome] || (l.agenda_outcome ? 'unknown' : 'scheduled'),
    date: data,
    standbyDate: dia(i.standbyDate),
    position: Number(l.posicao),
    scheduledTime: hora,
    scheduledAt: hora && data ? instanteOperacional(data, hora) : undefined,
    requestedTime: typeof i.requestedTime === 'string' ? i.requestedTime : undefined,
    contactPlan: planoDeContato(i.contactPlan),
    consultationId: typeof i.resolvedByConsultationId === 'string' ? i.resolvedByConsultationId : undefined,
    createdAt: iso(l.criado_em),
    updatedAt: iso(l.atualizado_em),
  });
}

/** @returns {{ appointments: object[], clientIds: string[], tarologistIds: string[], tarologoDoAgendamento: Map<string,string> }} */
async function montarAgenda({ hoje, focoIds, appointmentId }, f) {
  const linhas = await f.agenda({ dia: hoje, clientIds: focoIds, appointmentId, limite: LIMITES.AGENDA });
  if (linhas.length > LIMITES.AGENDA) throw new LimiteExcedido('appointments');
  return {
    appointments: linhas.map(linhaParaAgendamento),
    clientIds: [...new Set(linhas.map((l) => `${l.id_cliente}`))],
    tarologistIds: [...new Set(linhas.map((l) => `${l.id_tarologo}`))],
    tarologoDoAgendamento: new Map(linhas.map((l) => [`${l.id}`, `${l.id_tarologo}`])),
  };
}

module.exports = { montarAgenda, linhaParaAgendamento };
