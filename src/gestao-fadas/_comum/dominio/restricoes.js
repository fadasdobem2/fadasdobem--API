'use strict';

/**
 * Restrições cliente x taróloga (Maturacao/29 seção 10): porte de `restricoes/restriction-model.ts` (`restrictionRequester`,
 * `canManageRestriction`, `restrictionsVisibleTo`, `isAttendanceRestricted`, `changeRestriction`, `ownRestrictionClientIds`, `syncComplaintRestrictions`). O perfil
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

const MOTIVOS = { client: ['canc', 'gost', 'naoq', 'outr'], tarologist: ['naoa', 'outr'] };

/** `ownRestrictionClientIds` (v706): clientes de consultas dela (exceto "Erro") ou de restrição dela já acessível. */
function clientesDaTarologa(consultas, linhas, tarotId) {
  if (!tarotId) return [];
  return [...new Set([
    ...consultas.filter((c) => c.tarotId === tarotId && c.status !== 'Erro').map((c) => `${c.clientId}`.trim()),
    ...linhas.filter((l) => l.tarotId === tarotId && solicitante(l) === 'tarologist').map((l) => `${l.clientId}`.trim()),
  ].filter(Boolean))];
}

/** Relato da restrição (v706): motivo da lista de quem pediu, mensagem de 1 a 5.000 e data do fato, não futura (dia civil de São Paulo de `at`). */
function conferirDetalhes(quem, motivo, d, at) {
  const { reasonCode, message, occurredOn } = d;
  if (!MOTIVOS[quem].includes(reasonCode) || !`${motivo}`.trim()) erro('Escolha o motivo da restrição.');
  if (typeof message !== 'string' || !message.trim() || message.trim().length > 5000) erro('Registre a mensagem, com até 5.000 caracteres.');
  const dia = new Date(`${occurredOn}T12:00:00Z`);
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(`${occurredOn}`) || !Number.isFinite(dia.getTime()) || dia.toISOString().slice(0, 10) !== occurredOn || occurredOn > hoje) erro('Confira a data do relato.');
  return { reasonCode, message: message.trim(), occurredOn };
}

/** `changeRestriction` (restriction-model.ts, v706: a taróloga também INCLUI a própria restrição, de cliente dela). */
function alterar(linhas, i) {
  const quem = i.requestedBy ?? 'tarologist';
  if (quem !== 'tarologist' && quem !== 'client') erro('Identifique quem pediu a restrição.');
  if (!podeGerenciar(i.role, i.ownTarotId, i.tarotId, quem)) erro('Esta alteração não está disponível para seu acesso.');
  if (!`${i.actor}`.trim() || !i.id || !Number.isFinite(Date.parse(i.at))) erro('Não foi possível identificar esta alteração.');
  if (!`${i.clientId}`.trim() || !i.tarotId) erro('Selecione a cliente e o tarólogo.');
  if (`${i.reason}`.trim().length > 1000) erro('Use até 1.000 caracteres no motivo.');
  const detalhes = i.details && !i.remove ? conferirDetalhes(quem, i.reason, i.details, i.at) : undefined;
  const idx = linhas.findIndex((l) => l.active && l.clientId === `${i.clientId}`.trim() && l.tarotId === i.tarotId && solicitante(l) === quem);
  if (!i.remove && i.role === 'tarologa') {
    if (idx >= 0) erro('Esta restrição já está na lista. Para alterar o motivo, comunique ao atendimento.');
    if (!(i.allowedClientIds || []).includes(`${i.clientId}`.trim())) erro('Esta cliente não está disponível para seu acesso.');
  }
  if (i.remove && idx < 0) erro('Esta restrição já foi removida.');
  const action = i.remove ? 'removed' : idx < 0 ? 'created' : 'edited';
  const evento = { action, at: i.at, actor: i.actor, reason: `${i.reason}`.trim(), ...detalhes };
  if (idx < 0) return [...linhas, { id: i.id, clientId: `${i.clientId}`.trim(), tarotId: i.tarotId, requestedBy: quem, reason: `${i.reason}`.trim(), ...detalhes, active: true, createdAt: i.at, createdBy: i.actor, updatedAt: i.at, updatedBy: i.actor, history: [evento] }];
  return linhas.map((l, k) => (k !== idx ? l : { ...l, requestedBy: quem, active: !i.remove, reason: i.remove ? l.reason : `${i.reason}`.trim(), ...detalhes, updatedAt: i.at, updatedBy: i.actor, history: [...l.history, evento] }));
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

module.exports = { RestricaoInvalidaError, MOTIVOS, clientesDaTarologa, conferirDetalhes, solicitante, podeGerenciar, visiveisPara, estaRestrita, alterar, sincronizarQueixas };
