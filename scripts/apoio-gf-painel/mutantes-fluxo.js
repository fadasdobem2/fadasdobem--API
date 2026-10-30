'use strict';

/**
 * Mutantes do fluxo do painel (Maturacao/39): cada um recebe a ENTRADA de um caso e devolve uma cópia em que o front passa a RECUSAR o destino.
 * Usado pelo gerador do ouro (que registra a recusa do código real do front) e pelo verificador (o servidor tem de recusar com a mesma frase).
 */

const clonar = (v) => JSON.parse(JSON.stringify(v));
const relogio = (ms) => new Date(ms - 3 * 3600000).toISOString().slice(11, 16);
const dePerfil = (e, tarotId, fn) => { const n = clonar(e); const p = n.profiles.find((x) => x.id === tarotId); if (p) fn(p); return n; };

const MUTANTES = {
  restricao: (e, { item, tarotId }) => { const n = clonar(e); const a = n.agenda.find((x) => x.id === item); n.restrictions = [...(n.restrictions || []), { id: 'mut', clientId: a.clientId, tarotId, active: true }]; return n; },
  leitora_offline: (e, { tarotId }) => dePerfil(e, tarotId, (p) => { p.online = false; p.shiftStatus = 'Offline'; p.shiftExit = 'ended'; p.presenceDate = e.date; }),
  leitora_sem_confirmar: (e, { tarotId }) => dePerfil(e, tarotId, (p) => { p.shiftStatus = 'Disponível'; p.online = true; p.presenceConfirmation = { reason: 'idle', requestedAt: new Date(e.now).toISOString(), deadlineAt: new Date(e.now + 300000).toISOString() }; }),
  cadastro_inativo: (e, { tarotId }) => dePerfil(e, tarotId, (p) => { p.registrationActive = false; }),
  leitora_em_curso: (e, { item, tarotId }) => { const n = clonar(e); n.consultations.push({ id: 'kmut', clientId: 'outra-mut', client: 'Outra', tarotId, tarot: 'Leitora', status: 'Em curso', startedAt: new Date(e.now - 600000).toISOString(), durationSeconds: 100, audit: [], awaitingTarologistStart: false, tarologistStartedAt: new Date(e.now - 600000).toISOString() }); return n; },
  continuacao_reservada: (e, { tarotId }) => { const n = clonar(e); n.consultations.push({ id: 'kcont', clientId: 'outra-cont', client: 'Cliente cont', tarotId, tarot: 'Leitora', status: 'Concluída', startedAt: new Date(e.now - 1800000).toISOString(), endedAt: new Date(e.now - 600000).toISOString(), durationSeconds: 1200, audit: [], tarologistMoreTimeRequest: { active: true, requestedAt: new Date(e.now - 590000).toISOString(), reporterName: 'Leitora' } }); return n; },
  agenda_fechada: (e, { tarotId }) => { const n = clonar(e); n.intakeEvents = [...(n.intakeEvents || []), { id: 'evmut', tarotId, date: e.date, mode: 'no_more', at: new Date(e.now - 60000).toISOString(), by: 'Equipe', consultationIds: [], closeScope: 'day', closedUntil: new Date(e.now + 3600000).toISOString(), agendaIds: [] }]; return n; },
  outro_agendamento_da_cliente: (e, { item }) => { const n = clonar(e); const a = n.agenda.find((x) => x.id === item); n.agenda.push({ id: 'agmut', clientId: a.clientId, client: a.client, tarotId: 'r9', date: e.date, time: '09:00', createdAt: new Date(e.now - 900000).toISOString(), response: 'Aguardando resposta', position: 99, contact: { attempt: 1, date: e.date, tags: [] }, contactHistory: [] }); return n; },
  horario_futuro: (e, { item }) => { const n = clonar(e); const a = n.agenda.find((x) => x.id === item); a.date = e.date; a.scheduledTime = relogio(e.now + 3 * 3600000); a.contactPlan = undefined; a.requestedTime = undefined; return n; },
  cliente_vai_chamar: (e, { item }) => { const n = clonar(e); const a = n.agenda.find((x) => x.id === item); a.contactPlan = { who: 'client', timing: 'none' }; return n; },
  turno_encerrado: (e, { item }) => { const n = clonar(e); const a = n.agenda.find((x) => x.id === item); a.date = e.date; a.contactPlan = { who: 'staff', timing: 'shift', shift: { label: 'Passou', start: relogio(e.now - 7200000), end: relogio(e.now - 3600000) } }; return n; },
  outra_reservada: (e, { item, tarotId }) => { const n = clonar(e); n.agenda.push({ id: 'agres', clientId: 'cres', client: 'Reservada', tarotId: 'afila', date: e.date, time: '09:00', createdAt: new Date(e.now - 1200000).toISOString(), response: 'Aguardando resposta', position: 98, contact: { attempt: 1, date: e.date, tags: ['Pode agora'] }, contactHistory: [], queueReservation: { tarotId, at: new Date(e.now - 600000).toISOString(), by: 'Equipe' } }); return n; },
  cliente_ja_em_consulta: (e, { item }) => { const n = clonar(e); const a = n.agenda.find((x) => x.id === item); n.consultations.push({ id: 'kcli', clientId: a.clientId, client: a.client, tarotId: 'r9', tarot: 'Outra', status: 'Em curso', startedAt: new Date(e.now - 300000).toISOString(), durationSeconds: 10, audit: [], awaitingTarologistStart: false, tarologistStartedAt: new Date(e.now - 300000).toISOString() }); return n; },
  agendamento_encerrado: (e, { item }) => { const n = clonar(e); const a = n.agenda.find((x) => x.id === item); a.agendaOutcome = 'Cancelada'; a.contact = { attempt: 1, date: e.date, tags: ['Cancelada'] }; return n; },
  leitora_inexistente: (e) => clonar(e),
};

module.exports = { MUTANTES, clonar };
