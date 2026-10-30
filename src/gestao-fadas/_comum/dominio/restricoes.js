'use strict';

/**
 * Restrições cliente x taróloga (Maturacao/29 seção 10): porte de `restricoes/restriction-model.ts` (`restrictionRequester`,
 * `canManageRestriction`, `restrictionsVisibleTo`, `isAttendanceRestricted`, `changeRestriction`, `syncComplaintRestrictions`). O perfil
 * `canManageConsultations` é o de `domain/permissions.ts` (administradora, assistente, supervisora e atendente). Ouro do código real.
 */

class RestricaoInvalidaError extends Error { constructor(m) { super(m); this.name = 'RestricaoInvalidaError'; } }
const erro = (m) => { throw new RestricaoInvalidaError(m); };

const GERENCIA = new Set(['administradora', 'assistente', 'supervisora', 'atendente']);
const solicitante = (linha) => (linha.requestedBy === 'client' ? 'client' : 'tarologist');
function podeGerenciar(perfil, tarotProprio, tarotId, quem = 'tarologist') {
  return perfil === 'tarologa' ? quem === 'tarologist' && Boolean(tarotProprio && tarotProprio === tarotId) : GERENCIA.has(perfil);
}
const visiveisPara = (linhas, perfil, tarotProprio) => (perfil === 'tarologa' ? linhas.filter((l) => l.tarotId === tarotProprio && solicitante(l) === 'tarologist') : linhas);
const estaRestrita = (linhas, clientId, tarotId) => Boolean(clientId && tarotId && linhas.some((l) => l.active && l.clientId === `${clientId}`.trim() && l.tarotId === tarotId));

/** `changeRestriction` (restriction-model.ts). */
function alterar(linhas, i) {
  const quem = i.requestedBy ?? 'tarologist';
  if (quem !== 'tarologist' && quem !== 'client') erro('Identifique quem pediu a restrição.');
  if (!podeGerenciar(i.role, i.ownTarotId, i.tarotId, quem)) erro('Esta alteração não está disponível para seu acesso.');
  if (!i.remove && i.role === 'tarologa') erro('Para incluir ou alterar uma restrição, comunique ao atendimento.');
  if (!`${i.actor}`.trim() || !i.id || !Number.isFinite(Date.parse(i.at))) erro('Não foi possível identificar esta alteração.');
  if (!`${i.clientId}`.trim() || !i.tarotId) erro('Selecione a cliente e o tarólogo.');
  if (`${i.reason}`.trim().length > 1000) erro('Use até 1.000 caracteres no motivo.');
  const idx = linhas.findIndex((l) => l.active && l.clientId === `${i.clientId}`.trim() && l.tarotId === i.tarotId && solicitante(l) === quem);
  if (i.remove && idx < 0) erro('Esta restrição já foi removida.');
  const action = i.remove ? 'removed' : idx < 0 ? 'created' : 'edited';
  const evento = { action, at: i.at, actor: i.actor, reason: `${i.reason}`.trim() };
  if (idx < 0) return [...linhas, { id: i.id, clientId: `${i.clientId}`.trim(), tarotId: i.tarotId, requestedBy: quem, reason: `${i.reason}`.trim(), active: true, createdAt: i.at, createdBy: i.actor, updatedAt: i.at, updatedBy: i.actor, history: [evento] }];
  return linhas.map((l, k) => (k !== idx ? l : { ...l, requestedBy: quem, active: !i.remove, reason: i.remove ? l.reason : `${i.reason}`.trim(), updatedAt: i.at, updatedBy: i.actor, history: [...l.history, evento] }));
}

/** `syncComplaintRestrictions`: a primeira consulta cancelada por queixa restringe só aquele par. */
function sincronizarQueixas(linhas, consultas) {
  let proximas = linhas;
  for (const c of consultas) {
    const rev = c.cancellationReview;
    if (!rev || !c.clientId || !c.tarotId || proximas.some((l) => (l.complaintConsultationIds || []).includes(c.id))) continue;
    const idx = proximas.findIndex((l) => l.active && l.clientId === c.clientId && l.tarotId === c.tarotId && solicitante(l) === 'client');
    const reason = `Consulta ${c.id} cancelada por reclamação da cliente. Queixa registrada na consulta.`;
    const evento = { action: idx < 0 ? 'created' : 'edited', at: rev.requestedAt, actor: rev.requestedBy, reason };
    if (idx < 0) proximas = [...proximas, { id: `complaint-${c.id}`, clientId: c.clientId, tarotId: c.tarotId, requestedBy: 'client', complaintConsultationIds: [c.id], reason, active: true, createdAt: rev.requestedAt, createdBy: rev.requestedBy, updatedAt: rev.requestedAt, updatedBy: rev.requestedBy, history: [evento] }];
    else proximas = proximas.map((l, k) => (k === idx ? { ...l, complaintConsultationIds: [...(l.complaintConsultationIds || []), c.id], updatedAt: rev.requestedAt, updatedBy: rev.requestedBy, history: [...l.history, evento] } : l));
  }
  return proximas;
}

module.exports = { RestricaoInvalidaError, solicitante, podeGerenciar, visiveisPara, estaRestrita, alterar, sincronizarQueixas };
