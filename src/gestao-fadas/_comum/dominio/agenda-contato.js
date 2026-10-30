'use strict';

/**
 * Domínio puro do contato da Agenda, porte versionado de `features/agenda/agenda-contact.ts` do front do suspiro
 * (`agendaContact`, `agendaIsClosed`, `agendaContactSnapshot`, `agendaOriginDate`, `agendaActiveOn`, `nextAgendaPosition`).
 * Só o que a API precisa para decidir: item encerrado, contato vigente, posição nova e conferência do contato (`expectedContact`).
 * Sem banco, sem Express. Se o front mudar a regra, regerar os casos de `scripts/verificar-gf-agenda.js`.
 */

const { somarDias } = require('./horarios');

const CONTATO_RESPOSTAS = Object.freeze(['Não respondeu', 'Vai pagar', 'Não pode agora', 'Cliente vai chamar', 'Chama depois', 'Não voltou']);
const DESFECHOS_CONSULTA = Object.freeze(['Concluída', 'Adiada', 'Cancelada']);
/** `AgendaTag` do front (types.ts:38) mais "Pago", que o front grava como tag de evento (types.ts, AgendaContactEvent). */
const ETIQUETAS = Object.freeze(['Chamar cliente', 'Cliente vai chamar', 'Avisada', 'Pode agora', 'Não respondeu', 'Vai pagar', 'Não pagou', 'Não voltou', 'Não pode', 'Não pode agora', 'Chama depois', 'Avisar de novo', 'Em consulta', 'Concluída', 'Adiada', 'Cancelada', 'Taróloga não respondeu', 'Próximo turno', 'Pediu estorno']);

/** `isAgendaDate` do front (attendance-dates.ts). */
function ehDataCivil(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
}

/** `agendaContact` (agenda-contact.ts:28): o contato vigente, lendo o formato antigo sem inventar etiqueta. */
function contatoDe(item) {
  if (item.contact) {
    const tags = [...new Set(item.contact.tags.filter((t) => t !== 'Não pagou' && t !== 'Taróloga não respondeu').map((t) => (t === 'Não pode' ? 'Não pode agora' : t)))];
    const contato = { ...item.contact, tags };
    if (!tags.some((t) => ['Avisada', 'Avisar de novo'].includes(t))) {
      const aviso = [...(item.contactHistory || [])].reverse().find((e) => e.attempt === contato.attempt && e.tag === 'Avisada');
      if (aviso && aviso.active) contato.tags.unshift('Avisada');
    }
    return contato;
  }
  const tags = item.agendaOutcome ? [item.agendaOutcome]
    : item.resolvedByConsultationId || item.workflowStatus === 'Concluída' ? ['Concluída']
      : item.workflowStatus === 'Em consulta' ? ['Em consulta']
        : item.workflowStatus === 'Avisada' ? ['Avisada', ...(item.response === 'Não respondeu' ? ['Não respondeu'] : [])]
          : item.workflowStatus === 'Não pode' ? ['Não pode agora'] : [];
  return { attempt: 1, date: item.date || '2026-09-01', tags };
}

/** `agendaIsClosed` (agenda-contact.ts:41). */
function encerrado(item) {
  return Boolean(item.agendaOutcome || item.resolvedAt || item.resolvedByConsultationId || contatoDe(item).tags.some((t) => t === 'Concluída' || t === 'Cancelada'));
}

/** `agendaOriginDate` (agenda-contact.ts:46): o dia a que o item pertence (o do encaixe, se for "Se der hoje"). */
function dataDeOrigem(item, hoje) {
  const standby = item.standbyDate;
  if (standby && ehDataCivil(standby) && item.date === somarDias(standby, 1) && !encerrado(item) && item.workflowStatus !== 'Concluída'
    && !(item.departures || []).some((e) => e.action === 'cancel' && !e.restored)) return standby;
  return item.date || hoje;
}

/** `agendaActiveOn` (agenda-contact.ts:55). */
function ativoNoDia(item, data, hoje) {
  const origem = dataDeOrigem(item, hoje);
  return !encerrado(item) && (origem === data || (data === hoje && origem < data));
}

/** `nextAgendaPosition` (agenda-contact.ts:60). */
function proximaPosicao(itens, tarotId, data, hoje) {
  return Math.max(0, ...itens.filter((i) => i.tarotId === tarotId && ativoNoDia(i, data, hoje)).map((i) => i.position)) + 1;
}

/**
 * `agendaContactSnapshot` (agenda-contact.ts:79) como OBJETO. O front manda a string; a API compara os dois já lidos e com as chaves
 * em ordem (o jsonb do Postgres não guarda a ordem das chaves, então comparar texto não serve).
 */
function fotoDoContato(item) {
  const contato = contatoDe(item);
  const ev = item.contactHistory || [];
  return limpar({
    contact: { ...contato, tags: [...contato.tags].sort() }, lastEvent: ev.length ? ev[ev.length - 1].id : undefined, refundRequest: item.refundRequest,
    queueDeferral: item.queueDeferral, contactPlan: item.contactPlan, contactReturn: item.contactReturn, workflowStatus: item.workflowStatus,
    agendaOutcome: item.agendaOutcome, resolvedAt: item.resolvedAt,
  });
}

/** Remove `undefined` e ordena as chaves: forma canônica para comparar duas leituras do mesmo estado. */
function limpar(v) {
  if (Array.isArray(v)) return v.map(limpar);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, limpar(x)]));
  return v;
}
const mesmoContato = (esperado, item) => JSON.stringify(limpar(esperado)) === JSON.stringify(fotoDoContato(item));

module.exports = { CONTATO_RESPOSTAS, DESFECHOS_CONSULTA, ETIQUETAS, ehDataCivil, contatoDe, encerrado, dataDeOrigem, ativoNoDia, proximaPosicao, fotoDoContato, mesmoContato, limpar };
