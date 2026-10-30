'use strict';

/**
 * Painel, tempo e ordem da fila geral (domínio puro, Maturacao/39). Porte versionado do CÓDIGO do front `painel/panel-flow-model.ts:44-73`
 * (`generalQueueTiming`, `generalQueueGroup`, `compareGeneralWait`, `clientCanRespond`) e `agenda/queue-timing.ts:67-120` (`compareExplicitAgendaOrder`,
 * `compareYieldedAgendaOrder`, `agendaOrderScope`). Relógio injetado (`agora`).
 */

const { contatoDe } = require('./agenda-contato');
const b = require('./fila-geral-base');
const t = require('./painel-tempo');

const ETAPAS_QUE_ANULAM = ['Chamar cliente', 'Cliente vai chamar', 'Não respondeu', 'Não pode agora', 'Não voltou', 'Chama depois', 'Próximo turno', 'Vai pagar', 'Em consulta', 'Concluída', 'Cancelada', 'Adiada'];
const ETAPAS_DE_STATUS = ['Vai pagar', 'Não voltou', 'Não respondeu', 'Não pode agora', 'Chama depois', 'Próximo turno', 'Avisada'];

const clientePronta = (tags) => tags.includes('Pode agora') && !tags.some((x) => ETAPAS_QUE_ANULAM.includes(x));
/** `clientCanRespond`. */
const clientePodeResponder = (item, data) => { const contato = contatoDe(item); return (!data || contato.date === data) && clientePronta(contato.tags); };

const escopoDaData = (inicio, fim) => (fim === undefined ? `date:${inicio}` : `range:${[inicio, fim].sort().join(':')}`);
const escopoManual = (tarotId) => `explicit:${tarotId === 'afila' ? 'general' : `queue:${tarotId}`}`;
const escopoCedido = (tarotId) => `yield:queue:${tarotId}`;
const { compararPtBR } = require('./colacao-ptbr');
const idCmp = compararPtBR; // `localeCompare('pt-BR')` do front, sem ICU

/** `compareExplicitAgendaOrder`. */
function compararOrdemExplicita(p, q, escopo) {
  if (p.tarotId !== q.tarotId) return 0;
  const chave = escopoManual(p.tarotId);
  const rp = (p.positionOverrides || {})[chave] ?? (p.positionOverrides || {})[`explicit:${escopo}`];
  const rq = (q.positionOverrides || {})[chave] ?? (q.positionOverrides || {})[`explicit:${escopo}`];
  return rp !== undefined || rq !== undefined ? ((rp ?? Infinity) - (rq ?? Infinity)) || idCmp(p.id, q.id) : 0;
}
/** `compareYieldedAgendaOrder`. */
function compararOrdemCedida(p, q) {
  if (p.tarotId !== q.tarotId) return 0;
  const chave = escopoCedido(p.tarotId);
  const yp = (p.positionOverrides || {})[chave]; const yq = (q.positionOverrides || {})[chave];
  return yp !== undefined || yq !== undefined ? ((yp ?? Infinity) - (yq ?? Infinity)) || idCmp(p.id, q.id) : 0;
}

/** `generalQueueTiming`. */
function temporizacao(item, data, agora) {
  const pedidoEm = b.instantePedido(item, data); const entrouEm = t.entradaOriginal(item, data);
  const contato = contatoDe(item); const pronta = contato.date === data && clientePronta(contato.tags);
  const futuro = (item.date ?? data) > data || (pedidoEm !== null && pedidoEm > agora);
  const janela = !item.queueReservation && pedidoEm !== null && pedidoEm > agora && pedidoEm - agora <= 15 * 60_000;
  const relogio = pedidoEm !== null ? t.relogioSP(pedidoEm) : null;
  const dia = (item.date ?? data) > data ? `${item.date.slice(8, 10)}/${item.date.slice(5, 7)} · ` : '';
  const status = contato.tags.includes('Cliente vai chamar') ? 'Cliente vai chamar' : contato.tags.includes('Chamar cliente') ? 'Chamar cliente' : contato.tags.find((x) => ETAPAS_DE_STATUS.includes(x)) ?? (pronta ? 'Pode agora' : 'Chamar cliente');
  const espera = entrouEm === null ? 0 : Math.max(0, agora - entrouEm);
  return { requestedAt: pedidoEm, enteredAt: entrouEm, startsAt: entrouEm, future: futuro, waitingWindow: janela, active: pronta && !futuro, status, waitMs: espera,
    label: futuro ? `${dia}${item.contactPlan ? t.rotuloDoPlano(item) : relogio ? `${item.scheduledTime ? 'Às' : 'Quer às'} ${relogio}` : 'Horário marcado'}` : t.rotuloDecorrido(entrouEm, agora) };
}
/** `generalQueueGroup`. */
function grupo(item, data, agora) {
  if (b.temEstadoDeRetorno(item)) return 'callback';
  const tempo = temporizacao(item, data, agora);
  return tempo.future && !tempo.waitingWindow ? 'scheduled' : 'waiting';
}
/** `compareGeneralWait`. */
function compararEspera(p, q, data, agora, decrescente = true) {
  const posto = compararOrdemExplicita(p, q, escopoDaData(data)) || compararOrdemCedida(p, q); if (posto) return posto;
  const recuo = Number(Boolean(b.recessoComum(p))) - Number(Boolean(b.recessoComum(q))); if (recuo) return recuo;
  const tp = t.entradaOriginal(p, data); const tq = t.entradaOriginal(q, data);
  if (tp === null || tq === null) return (Number(tp === null) - Number(tq === null)) || (p.position - q.position) || idCmp(p.id, q.id);
  return ((decrescente ? tp - tq : tq - tp)) || (p.position - q.position) || idCmp(p.id, q.id);
}

/** `compareGeneralQueueAge`. */
function compararIdadeDaFila(p, z, data, decrescente = true) {
  const tp = t.entradaOriginal(p, data); const tz = t.entradaOriginal(z, data);
  if (tp === null || tz === null) return (Number(tp === null) - Number(tz === null)) || (p.position - z.position) || idCmp(p.id, z.id);
  return ((decrescente ? tp - tz : tz - tp)) || (p.position - z.position) || idCmp(p.id, z.id);
}
/** `generalCallbackEnteredAt`: início da estadia mais recente em "Depois" nesta tentativa; evidência faltando fica desconhecida (null). */
function chegadaNoDepois(item) {
  if (!b.temEstadoDeRetorno(item)) return null;
  const contato = contatoDe(item);
  if (b.temEsperaAdiada(item) && item.queueDeferral) { const em = Date.parse(item.queueDeferral.at); if (Number.isFinite(em)) return em; }
  let entrou = null;
  for (const e of item.contactHistory || []) {
    if (e.attempt !== contato.attempt) continue;
    if (!e.after) { entrou = null; continue; }
    const antes = e.before && e.before.some(b.ehEtiquetaDeRetorno); const depois = e.after.some(b.ehEtiquetaDeRetorno);
    if (!depois) { entrou = null; continue; }
    if (antes === undefined) { entrou = null; continue; }
    if (!antes) { const em = Date.parse(e.at); entrou = Number.isFinite(em) ? em : null; }
  }
  return entrou;
}
/** `compareGeneralCallbackWait`. */
function compararEsperaDoDepois(p, z, data, _agora, decrescente = true) {
  const tp = chegadaNoDepois(p) ?? t.entradaOriginal(p, data); const tz = chegadaNoDepois(z) ?? t.entradaOriginal(z, data);
  if (tp === null || tz === null) return (Number(tp === null) - Number(tz === null)) || compararIdadeDaFila(p, z, data, decrescente);
  return ((decrescente ? tp - tz : tz - tp)) || compararIdadeDaFila(p, z, data, decrescente);
}

module.exports = { compararIdadeDaFila, chegadaNoDepois, compararEsperaDoDepois, clientePronta, clientePodeResponder, escopoDaData, escopoManual, escopoCedido, idCmp, compararOrdemExplicita, compararOrdemCedida, temporizacao, grupo, compararEspera };
