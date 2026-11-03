'use strict';

/**
 * Mutantes dos prazos (Maturacao/56 grupo D): cada um recebe a ENTRADA de um caso de espera e devolve uma cópia alterada. O gerador grava o que o front
 * responde à cópia; o verificador exige a MESMA resposta do domínio portado (mesma frase, mesmo número) e conta os que mudaram o resultado do caso base.
 */
const { clonar } = require('./cenarios');
const iso = (ms) => new Date(ms).toISOString();
const com = (e, fn) => { const n = clonar(e); fn(n, n.agenda[0]); return n; };

const MUTANTES = {
  fecha_item: (e) => com(e, (n, a) => { a.agendaOutcome = 'Cancelada'; }),
  cliente_em_consulta: (e) => com(e, (n, a) => { n.consultations.push({ id: 'kmut', clientId: a.clientId, client: 'C', tarotId: 'r9', tarot: 'L', status: 'Em curso', startedAt: iso(n.now - 600000), durationSeconds: 600, audit: [] }); }),
  pagamento_depois_do_aviso: (e) => com(e, (n, a) => { const ini = Date.parse((a.contactHistory[0] || { at: iso(n.now) }).at); n.payments.push({ id: 'pmut', clientId: a.clientId, client: 'C', amount: 88.8, status: 'Informado', method: 'PIX', paidAt: iso(ini + 1000), informedAt: iso(ini + 1000) }); }),
  pagamento_a_confirmar: (e) => com(e, (n, a) => { const ini = Date.parse((a.contactHistory[0] || { at: iso(n.now) }).at); n.payments.push({ id: 'pmut2', clientId: a.clientId, client: 'C', amount: 88.8, status: 'Informado', confirmation: 'A confirmar', method: 'PIX', paidAt: iso(ini + 1000), informedAt: iso(ini + 1000) }); }),
  tira_aviso: (e) => com(e, (n, a) => { a.contact.tags = a.contact.tags.filter((t) => t !== 'Avisada'); a.contactHistory.forEach((r) => { if (r.tag === 'Avisada') r.active = false; }); }),
  responde_pode_agora: (e) => com(e, (n, a) => { const ini = Date.parse((a.contactHistory[0] || { at: iso(n.now) }).at); a.contactHistory.push({ id: 'ev-pode', actor: 'Equipe', at: iso(ini + 1000), date: a.contact.date, attempt: a.contact.attempt, tag: 'Pode agora', active: true, before: [], after: ['Pode agora'] }); }),
  prazo_combinado_10min: (e) => com(e, (n, a) => { const ini = Date.parse((a.contactHistory[0] || { at: iso(n.now) }).at); a.requestedWaitHistory = [{ id: 'wait-mut', minutes: 10, at: iso(ini + 1000), by: 'Equipe', attempt: a.contact.attempt, afterEventId: (a.contactHistory[a.contactHistory.length - 1] || {}).id || '' }]; }),
  espera_adiada: (e) => com(e, (n, a) => { a.queueDeferral = { attempt: 1, at: iso(n.now - 60000), by: 'Equipe', reason: 'Chama depois' }; }),
  outro_dia: (e) => com(e, (n) => { n.date = new Date(Date.parse(`${n.date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10); }),
  relogio_mais_1ms: (e) => com(e, (n) => { n.now += 1; }),
  relogio_menos_1ms: (e) => com(e, (n) => { n.now -= 1; }),
  relogio_mais_5min: (e) => com(e, (n) => { n.now += 300000; }),
  relogio_menos_5min: (e) => com(e, (n) => { n.now -= 300000; }),
  evento_mais_antigo_1s: (e) => com(e, (n, a) => { a.contactHistory.forEach((r) => { r.at = iso(Date.parse(r.at) - 1000); }); }),
  evento_mais_novo_1s: (e) => com(e, (n, a) => { a.contactHistory.forEach((r) => { r.at = iso(Date.parse(r.at) + 1000); }); }),
};

module.exports = { MUTANTES };
