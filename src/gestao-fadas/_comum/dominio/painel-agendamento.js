'use strict';

/**
 * Painel, agendar a cliente da fila geral (domínio puro, Maturacao/39). Porte versionado do CÓDIGO do front: `painel/panel-flow-model.ts`
 * (`generalMatchDestination` :323, `scheduleGeneralMatch` :329), `agenda/agenda-contact-plan.ts` (`normalizedAgendaContactPlan`, `applyAgendaContactPlan`),
 * `agenda/agenda-contact-reschedule.ts` (`resetAgendaContactForReschedule`) e `agenda/agenda-requested-wait.ts` (`requestedWaitHistory`).
 * O servidor MONTA o agendamento (mesmas regras, mesmas frases) a partir da intenção: taróloga, data, horário, plano de contato, posição e a
 * confirmação do aviso de disponibilidade. Relógio injetado; ids de evento vêm de `novoId`.
 */

const { randomUUID } = require('crypto');
const { contatoDe, encerrado, ativoNoDia } = require('./agenda-contato');
const { ehDeCliente } = require('./agenda-identidade');
const { normalizar: normalizarFormatacao } = require('./texto-formatado');
const { limparAdiamento, registrarMudancaDeAgendamento } = require('./fila-geral');
const { lerPlano, normalizarRelogio } = require('./agenda-etiqueta');
const s = require('./financeiro-saldo');
const t = require('./painel-tempo');
const o = require('./painel-ordem');
const v = require('./painel-validacao');
const { fluxoDoPainel } = require('./painel-fluxo');
const { avisoDeDisponibilidade } = require('./painel-aviso');

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** `normalizedAgendaContactPlan`. */
function planoNormalizado(plano) {
  if (!['staff', 'client'].includes(plano.who) || !['none', 'exact', 'approximate', 'after', 'shift'].includes(plano.timing)) throw new v.RegraDoPainelError('Confira o combinado de contato.');
  const r = { who: plano.who, timing: plano.timing, ...(plano.callback ? { callback: true } : {}) };
  if (['exact', 'approximate', 'after'].includes(plano.timing)) {
    const hora = normalizarRelogio(plano.time ?? ''); if (!hora) throw new v.RegraDoPainelError('Informe um horário válido, como 20:00.'); r.time = hora;
  } else if (plano.timing === 'shift') {
    const ini = normalizarRelogio((plano.shift && plano.shift.start) ?? ''); const fim = normalizarRelogio((plano.shift && plano.shift.end) ?? '');
    if (!ini || !fim || !(plano.shift && plano.shift.label && plano.shift.label.trim()) || ini === fim) throw new v.RegraDoPainelError('Escolha um turno válido da profissional.');
    r.shift = { label: plano.shift.label.trim(), start: ini, end: fim };
  }
  return r;
}

/** `requestedWaitHistory`. */
function historicoDePrazo(item) {
  if (item.requestedWaitHistory && item.requestedWaitHistory.length) return item.requestedWaitHistory;
  const antigo = item.queuePaymentWait; const em = antigo && (antigo.requestedAt ?? antigo.at);
  return antigo && antigo.requestedMinutes && em && Number.isFinite(Date.parse(em)) ? [{ id: `legacy-${item.id}-${em}`, minutes: antigo.requestedMinutes, at: em, by: antigo.editedBy || antigo.by }] : [];
}

/** `resetAgendaContactForReschedule`. */
function zerarContatoParaReagendar(item, data, ator, em, novoId) {
  const atual = contatoDe(item); const tentativa = atual.attempt + 1;
  const esperas = historicoDePrazo(item).map((w) => (w.attempt === undefined ? { ...w, attempt: atual.attempt } : w));
  return { ...limparAdiamento(item, ator, em), contact: { date: data, attempt: tentativa, tags: [] }, response: 'Aguardando resposta', workflowStatus: undefined, agendaOutcome: undefined, resolvedAt: undefined, resolvedByConsultationId: undefined,
    queuePaymentWait: undefined, requestedWaitHistory: esperas.length ? esperas : item.requestedWaitHistory, reservationClock: item.reservationClock ? { ...item.reservationClock, active: false } : undefined, immediateReservationRelease: undefined,
    contactHistory: [...(item.contactHistory ?? []), { id: novoId(), actor: ator, at: em, date: data, attempt: tentativa, tag: 'Chamar cliente', active: false, before: atual.tags, after: [] }] };
}

/** `applyAgendaContactPlan` (com `reschedule` e `releaseReservation`, como o agendamento da fila geral usa). */
function aplicarPlano(item, entrada, opcoes, novoId) {
  const plano = planoNormalizado(entrada);
  const rodando = item.workflowStatus === 'Em consulta' || (item.contact && item.contact.tags.includes('Em consulta'));
  if (rodando) {
    if (opcoes.reschedule || opcoes.releaseReservation || JSON.stringify(planoNormalizado(lerPlano(item))) !== JSON.stringify(plano)) throw new v.RegraDoPainelError('Finalize a consulta em andamento antes de alterar o agendamento.');
    return item;
  }
  const base = opcoes.reschedule ? zerarContatoParaReagendar(item, opcoes.date, opcoes.actor, opcoes.at, novoId) : item;
  const contato = base.contact ?? { attempt: 1, date: opcoes.date, tags: [] }; const antes = contato.tags;
  let tags = antes.filter((x) => !['Chamar cliente', 'Cliente vai chamar', 'Chama depois'].includes(x));
  if (plano.who === 'client' || plano.callback) tags = tags.filter((x) => !['Pode agora', 'Não respondeu', 'Não voltou', 'Não pode agora', 'Próximo turno'].includes(x));
  if (plano.who === 'client') tags.push('Cliente vai chamar'); else if (plano.callback) tags.push('Chama depois'); else if (antes.includes('Chamar cliente')) tags.push('Chamar cliente');
  const mudou = JSON.stringify(antes) !== JSON.stringify(tags);
  const proximo = { ...base, date: opcoes.date, contactPlan: plano, scheduledTime: plano.timing === 'exact' ? plano.time : undefined,
    requestedTime: plano.timing === 'approximate' ? plano.time : plano.timing === 'after' ? `A partir das ${plano.time}` : plano.timing === 'shift' && plano.shift ? t.rotuloDoPlano({ contactPlan: plano }) : undefined,
    contact: { ...contato, date: opcoes.date, tags },
    ...(plano.who === 'client' || plano.callback ? { workflowStatus: tags.includes('Avisada') ? 'Avisada' : undefined, response: 'Aguardando resposta' } : {}),
    contactHistory: mudou ? [...(base.contactHistory ?? []), { id: novoId(), actor: opcoes.actor, at: opcoes.at, date: opcoes.date, attempt: contato.attempt, tag: plano.who === 'client' ? 'Cliente vai chamar' : plano.callback ? 'Chama depois' : 'Chamar cliente', active: true, before: antes, after: tags }] : base.contactHistory };
  if (opcoes.releaseReservation) {
    proximo.queueReservation = undefined;
    proximo.queueReservationHistory = item.queueReservation ? [...(item.queueReservationHistory ?? []), { previousTarotId: item.queueReservation.tarotId, at: opcoes.at, by: opcoes.actor }] : item.queueReservationHistory;
    proximo.reservationClock = item.reservationClock ? { ...item.reservationClock, active: false } : undefined; proximo.immediateReservationRelease = undefined;
  }
  return proximo;
}

/** `generalMatchDestination`: cobertura da cliente e a área para onde a tela leva (consultas ou agenda). */
function destinoDoAgendamento(entrada, itemId, tarotId, perfil, preferirAgenda = false) {
  const { item } = v.validarAberturaDoAgendamento(entrada, itemId, tarotId);
  const cobertura = s.coberturaDaCliente(item.clientId, entrada.payments || [], entrada.consultations, perfil, new Date(entrada.now).toISOString());
  const livre = fluxoDoPainel(entrada).free.some((r) => r.id === tarotId);
  return { ...cobertura, area: !preferirAgenda && cobertura.canLaunch && livre ? 'consultations' : 'agenda' };
}

/** `scheduleGeneralMatch`: devolve a agenda inteira já com o agendamento composto e a ordem recalculada. */
function montarAgendamento(entrada, itemId, tarotId, detalhes, perfil, ator, novoId = randomUUID) {
  const { item } = v.validarAgendamento(entrada, itemId, tarotId, detalhes.date, detalhes.time, detalhes.contactPlan, detalhes.requestedTime);
  if (!DATA.test(detalhes.date) || !Number.isFinite(Date.parse(detalhes.date)) || detalhes.date < entrada.date) throw new v.RegraDoPainelError('Escolha hoje ou uma data futura.');
  const plano = detalhes.contactPlan;
  const aviso = avisoDeDisponibilidade({ profile: entrada.profiles.find((r) => r.id === tarotId), overrides: entrada.overrides || {}, date: detalhes.date,
    time: plano && plano.timing === 'after' ? plano.time : plano && plano.timing === 'shift' ? plano.shift && plano.shift.start : detalhes.time, requestedTime: detalhes.requestedTime, timeKind: plano && plano.timing, now: entrada.now, intakeEvents: entrada.intakeEvents });
  if (aviso && detalhes.availabilityConfirmation !== aviso.key) throw new v.RegraDoPainelError(aviso.message);
  const fila = entrada.agenda.filter((r) => r.id !== item.id && r.tarotId === tarotId && !encerrado(r) && r.workflowStatus !== 'Em consulta' && ativoNoDia(r, detalhes.date, entrada.date))
    .sort((p, z) => o.compararFila(p, z, entrada.now, detalhes.date, detalhes.date === entrada.date));
  const indice = detalhes.position === 'last' ? fila.length : Math.max(0, Math.min(fila.length, detalhes.position - 1));
  const cobertura = s.coberturaDaCliente(item.clientId, entrada.payments || [], entrada.consultations, perfil, new Date(entrada.now).toISOString()); const em = new Date(entrada.now).toISOString();
  const texto = `${detalhes.observation}`.trim() || 'Sem observações.';
  const agendado = { ...item, tarotId, date: detalhes.date, scheduledTime: detalhes.time || undefined, requestedTime: detalhes.requestedTime || undefined, observation: texto,
    observationFormatting: normalizarFormatacao(texto, 'observationFormatting' in detalhes ? detalhes.observationFormatting : item.observationFormatting), paymentPending: ehDeCliente(item) && !cobertura.canConsult, position: indice + 1, positionOverrides: undefined,
    standbyDate: undefined, forwardedAt: undefined, forwardedBy: undefined, forwardedDate: undefined, contact: { ...contatoDe(item), date: detalhes.date } };
  const atualizado = registrarMudancaDeAgendamento(item, plano ? aplicarPlano(agendado, plano, { actor: ator, at: em, date: detalhes.date, reschedule: true, releaseReservation: true }, novoId) : agendado, ator, em, novoId);
  const ids = fila.map((r) => r.id); ids.splice(indice, 0, item.id);
  const proxima = entrada.agenda.map((r) => (r.id === item.id ? atualizado : r));
  return o.reordenar(o.reordenar(proxima, ids, require('./painel-fila-geral').escopoDaData(detalhes.date), detalhes.position !== 'last'), ids, require('./painel-fila-geral').escopoDaData(detalhes.date, detalhes.date), detalhes.position !== 'last');
}

module.exports = { planoNormalizado, historicoDePrazo, zerarContatoParaReagendar, aplicarPlano, destinoDoAgendamento, montarAgendamento };
