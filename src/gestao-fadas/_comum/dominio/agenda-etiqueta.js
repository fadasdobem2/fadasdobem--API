'use strict';

/**
 * Etiquetas de contato da Agenda (domínio puro, Maturacao/39). Porte versionado de `agenda/agenda-contact.ts` (`toggleAgendaTag` :137-205,
 * `agendaVisibleTags` :63, `agendaTagIsReadOnly` :69, `agendaTagChoices` :107) e `agenda/agenda-contact-plan.ts` (`normalizeAgendaClock`,
 * `readAgendaContactPlan`). O front só usa isto, na leitura do painel, para `hydrateMoreTimeAgendaContact` (sempre com `eventId` e
 * `intent: 'activate'`); por isso o ramo "Pediu estorno" de `toggleAgendaTag` NÃO foi portado (inalcançável por essa via) e o `id` do evento
 * é sempre recebido, nunca sorteado. O relógio é injetado: o instante vem em `at`.
 */

const { contatoDe, encerrado } = require('./agenda-contato');
const b = require('./fila-geral-base');
const { limparAdiamento } = require('./fila-geral');

const RESPOSTAS = ['Não respondeu', 'Vai pagar', 'Não pode agora', 'Cliente vai chamar', 'Chama depois', 'Não voltou'];
const DESFECHOS = ['Concluída', 'Adiada', 'Cancelada'];

function normalizarRelogio(bruto) {
  const m = `${bruto}`.trim().match(/^(\d{1,2})(?:(?::|h)(\d{1,2})?)?$/i);
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2] || 0);
  return h <= 23 && mi <= 59 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null;
}
function lerPlano(item) {
  if (item && item.contactPlan) return { ...item.contactPlan, shift: item.contactPlan.shift ? { ...item.contactPlan.shift } : undefined };
  const tags = (item && item.contact && item.contact.tags) || [];
  const exato = normalizarRelogio((item && item.scheduledTime) || ''); const aprox = normalizarRelogio((item && item.requestedTime) || '');
  return { who: tags.includes('Cliente vai chamar') ? 'client' : 'staff', timing: exato ? 'exact' : aprox ? 'approximate' : 'none', ...(exato || aprox ? { time: exato || aprox } : {}), callback: tags.includes('Chama depois') || tags.includes('Cliente vai chamar') };
}

function etiquetasVisiveis(item) {
  const tags = contatoDe(item).tags;
  const etapa = tags.find((t) => t === 'Em consulta' || DESFECHOS.includes(t));
  return [...(etapa ? [...tags.filter((t) => t === 'Avisada'), etapa] : tags), ...(item.refundRequest ? ['Pediu estorno'] : [])];
}
function etiquetaSomenteLeitura(item, tag) {
  const contato = contatoDe(item);
  const evento = b.eventoDeTempoEsgotado(item, contato.attempt);
  return tag !== 'Pediu estorno' && (encerrado(item) || (tag === 'Avisada' && contato.tags.some((v) => v === 'Em consulta' || DESFECHOS.includes(v)))
    || (contato.tags.includes(tag) && (evento && evento.tag) === tag));
}
function escolhasDeEtiqueta(item) {
  const tags = contatoDe(item).tags;
  if (encerrado(item)) return [...new Set([...etiquetasVisiveis(item), 'Pediu estorno'])];
  if (tags.includes('Em consulta')) return [...tags.filter((t) => t === 'Avisada'), 'Em consulta', ...DESFECHOS, 'Pediu estorno'];
  if (tags.some((t) => DESFECHOS.includes(t))) return [...new Set([...etiquetasVisiveis(item), 'Avisar de novo', 'Em consulta', 'Cancelada', 'Pediu estorno'])];
  return [...new Set(['Chamar cliente', 'Avisada', 'Pode agora', ...RESPOSTAS, ...((item.contactHistory || []).length || tags.length ? ['Avisar de novo'] : []), 'Próximo turno', 'Em consulta', 'Cancelada', 'Pediu estorno'])];
}

/** `toggleAgendaTag` (sem "Pediu estorno"); `idEvento` é obrigatório (determinismo). */
function alternarEtiqueta(item, tag, ator, em, data, permitirDesfecho, idEvento, intencao = 'toggle') {
  const atual = contatoDe(item);
  if (['Avisada', 'Não respondeu', 'Não voltou'].includes(tag) && etiquetaSomenteLeitura(item, tag)) return item;
  const ativa = intencao === 'activate' || !atual.tags.includes(tag) || (tag === 'Pode agora' && atual.date !== data);
  if (!escolhasDeEtiqueta(item).includes(tag) && !(intencao === 'activate' && tag === 'Pode agora') && !(permitirDesfecho && (tag === 'Concluída' || tag === 'Cancelada'))) return item;
  let tags = [...atual.tags]; let tentativa = atual.attempt; let dataContato = atual.date;
  if (tag === 'Chamar cliente' && ativa) { tentativa += 1; dataContato = data; tags = ['Chamar cliente']; }
  else if (tag === 'Avisar de novo' || (tag === 'Avisada' && !ativa)) { if (tag === 'Avisada' || ativa) tentativa += 1; dataContato = data; tags = tag === 'Avisar de novo' && ativa ? ['Avisar de novo'] : []; }
  else if (!ativa) { tags = tags.filter((v) => v !== tag); if (tag === 'Concluída' || tag === 'Cancelada') { tags = []; tentativa += 1; dataContato = data; } }
  else if (tag === 'Avisada') { tags = [...tags.filter((v) => (v === 'Pode agora' || v === 'Vai pagar') && atual.date === data), 'Avisada']; dataContato = data; }
  else if (tag === 'Pode agora') {
    if (atual.date !== data) { tentativa += 1; tags = []; }
    tags = [...tags.filter((v) => !['Pode agora', 'Chamar cliente', 'Cliente vai chamar', 'Não respondeu', 'Não voltou', 'Não pode agora', 'Chama depois', 'Avisar de novo', 'Próximo turno'].includes(v)), tag]; dataContato = data;
  } else if (tag === 'Vai pagar') tags = [...tags.filter((v) => v !== 'Vai pagar'), tag];
  else if (RESPOSTAS.includes(tag)) { tags = [...tags.filter((v) => (v === 'Vai pagar' || !RESPOSTAS.includes(v)) && v !== 'Avisar de novo' && v !== 'Chamar cliente' && v !== 'Pode agora' && v !== 'Próximo turno'), tag]; dataContato = data; }
  else if (tag === 'Próximo turno') { tags = [...tags.filter((v) => v === 'Avisada' || v === 'Vai pagar'), tag]; dataContato = data; }
  else if (tag === 'Em consulta' || DESFECHOS.includes(tag)) { tags = [...tags.filter((v) => v === 'Avisada'), tag]; dataContato = data; }
  else { tags.push(tag); if (tag === 'Não voltou') tags = tags.filter((v) => v !== 'Pode agora'); }
  const desfecho = tags.includes('Concluída') ? 'Concluída' : tags.includes('Cancelada') ? 'Cancelada' : undefined;
  const retomada = tentativa !== atual.attempt || (ativa && ['Avisada', 'Chamar cliente', 'Avisar de novo', 'Pode agora', 'Não pode agora', 'Cliente vai chamar', 'Chama depois', 'Próximo turno', 'Em consulta', ...DESFECHOS].includes(tag));
  const base = retomada ? limparAdiamento(item, ator, em) : item;
  const plano = ativa && ['Cliente vai chamar', 'Chama depois', 'Chamar cliente', 'Avisar de novo'].includes(tag)
    ? { ...lerPlano(item), who: tag === 'Cliente vai chamar' ? 'client' : 'staff', callback: tag === 'Cliente vai chamar' || tag === 'Chama depois' }
    : ativa && tag === 'Pode agora' && item.contactPlan ? { ...item.contactPlan, who: 'staff', callback: false }
      : !ativa && item.contactPlan && ['Cliente vai chamar', 'Chama depois'].includes(tag) ? { ...item.contactPlan, who: 'staff', callback: false } : item.contactPlan;
  return { ...base, ...(plano ? { contactPlan: plano } : {}), contact: { attempt: tentativa, date: dataContato, tags },
    ...(ativa && ['Avisar de novo', 'Avisada', 'Chamar cliente', 'Pode agora'].includes(tag) && b.reservaJaExpirou(item)
      ? { queueReservation: undefined, queueReservationHistory: [...(item.queueReservationHistory ?? []), { previousTarotId: item.queueReservation.tarotId, at: em, by: ator }] } : {}),
    ...(tag === 'Próximo turno' && ativa ? { forwardedDate: undefined, forwardedAt: undefined, forwardedBy: undefined, standbyDate: undefined } : {}),
    workflowStatus: tags.includes('Em consulta') ? 'Em consulta' : desfecho === 'Concluída' ? 'Concluída' : desfecho || tags.includes('Adiada') ? undefined : tags.includes('Não pode agora') ? 'Não pode' : tags.includes('Avisada') ? 'Avisada' : undefined,
    response: tags.includes('Não respondeu') ? 'Não respondeu' : 'Aguardando resposta',
    agendaOutcome: desfecho, resolvedAt: desfecho ? em : undefined,
    resolvedByConsultationId: desfecho === 'Concluída' ? item.resolvedByConsultationId : undefined,
    contactHistory: [...(item.contactHistory || []), { id: idEvento, actor: ator, at: em, date: data, attempt: tentativa, tag, active: ativa, before: atual.tags, after: tags }] };
}

module.exports = { normalizarRelogio, lerPlano, etiquetasVisiveis, etiquetaSomenteLeitura, escolhasDeEtiqueta, alternarEtiqueta };
