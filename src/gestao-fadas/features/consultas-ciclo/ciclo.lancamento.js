'use strict';

/**
 * Monta o registro de um LANÇAMENTO (`POST /consultations`) a partir do que o front mandou, decidindo no servidor o que o contrato
 * (Maturacao/28 seção 4.4) reserva a ele: estado inicial, instantes (relógio do servidor), comissão capturada UMA vez, autor,
 * auditoria "Consulta criada", limite de tempo (pré-paga exige máximo), ocupação e continuação (mesma cliente e tarólogo da origem).
 * Do registro do navegador só passam os campos listados em `DO_FRONT`; histórias, relato final, pausas e decisões financeiras
 * nunca entram por aqui.
 */

const dom = require('../../_comum/dominio/consulta-comum');
const comum = require('./ciclo.comum');

const DO_FRONT = ['clientId', 'client', 'tarotId', 'tarot', 'channel', 'paymentProfile', 'expectedMinutes', 'timeLimit', 'maximumMinutesAtStart',
  'maximumIncludesPendingAtStart', 'billing', 'coverage', 'minuteBenefits', 'benefitConsumptionOrder', 'paidMinutesBeforeBenefits', 'launchTimeDecision',
  'specialPrice', 'continuation', 'agendaItemId', 'occupancyOverride', 'observation', 'observationFormatting', 'tarologistObservation',
  'tarologistObservationFormatting', 'paymentDisposition', 'minuteValue', 'financialReason', 'relatedConsultationId'];
/** Lançamento de histórico já encerrado (digitado pela equipe): estes desfechos entram prontos. Os demais nascem "Em curso". */
const HISTORICOS = new Set(['Concluída', 'Cancelada', 'Devolvida', 'Não houve', 'Desistiu']);
const TOLERANCIA_RELOGIO_MS = 2 * 60 * 1000;

const instanteSensato = (v, agoraMs) => { const t = Date.parse(v); return Number.isFinite(t) && t <= agoraMs + TOLERANCIA_RELOGIO_MS && new Date(t).getUTCFullYear() >= 2000; };

/**
 * Cobertura que o front calculou (crédito, bônus, cortesia, complemento): o servidor confere a FORMA e o vínculo, não o saldo (os
 * pagamentos ainda não são reais aqui). Tipo conhecido, minutos inteiros não negativos e, no complemento, a consulta de origem existente,
 * da mesma cliente e do mesmo tarólogo (consultation-billing.ts `validateComplementChanges`).
 */
function conferirCobertura(cobertura, base, origemCobertura) {
  if (cobertura === undefined) return;
  if (!cobertura || !['Crédito', 'Bônus', 'Cortesia', 'Complemento'].includes(cobertura.kind)) throw new dom.RegraConsultaError('Confira a cobertura da consulta.');
  if (!Number.isFinite(cobertura.minutes) || cobertura.minutes < 0 || cobertura.minutes > 1440) throw new dom.RegraConsultaError('Confira os minutos da cobertura.');
  if (cobertura.kind === 'Complemento') {
    if (!origemCobertura || origemCobertura.clientId !== base.clientId || origemCobertura.tarotId !== base.tarotId) throw new dom.RegraConsultaError('O complemento precisa de uma consulta anterior da mesma cliente e do mesmo tarólogo.');
  }
}

function montarLancamento(r, { a, agora, abertas, origem, taxa, origemCobertura }) {
  const agoraMs = Date.parse(agora);
  const base = {};
  for (const k of DO_FRONT) if (r[k] !== undefined) base[k] = r[k];
  dom.nome(base.client, 'Cliente'); dom.nome(base.tarot, 'Tarólogo');
  if (base.observation !== undefined) base.observation = dom.observacao(base.observation, 'Observação');
  if (base.tarologistObservation !== undefined) base.tarologistObservation = dom.observacao(base.tarologistObservation, 'Observação para o tarólogo');
  conferirCobertura(base.coverage, base, origemCobertura);
  const historico = HISTORICOS.has(r.status);
  const aguardando = !historico && r.awaitingTarologistStart !== false;
  // Pré-paga exige tempo máximo; pós-paga sem valor é tempo livre (consultation-time-limit.ts).
  const limite = dom.limiteDe({ ...base, timeLimit: base.timeLimit });
  if (limite.kind === 'unknown') base.timeLimit = dom.limiteDeMinutos(base.expectedMinutes, base.paymentProfile);
  else base.timeLimit = limite;
  if (r.continuation) {
    if (!origem) throw new dom.RegraConsultaError('A consulta de origem da continuação não foi encontrada.');
    if (origem.clientId !== base.clientId || origem.tarotId !== base.tarotId) throw new dom.RegraConsultaError('A continuação precisa ser da mesma cliente e do mesmo tarólogo da consulta de origem.');
    base.continuation = { sourceConsultationId: origem.id, kind: 'extension', registeredBy: a.nome, registeredAt: agora };
  }
  if (!historico) {
    const conflito = dom.conflitosDeOcupacao(abertas, base.tarotId, base.clientId, undefined, false, base.occupancyOverride)[0];
    if (conflito) throw comum.conflitoOcupacao(`Encerre a consulta de ${conflito.client} antes de iniciar outra.`);
  }
  let inicio = agora;
  if (!aguardando && r.startedAt !== undefined) {
    if (!instanteSensato(r.startedAt, agoraMs)) throw new dom.RegraConsultaError('Informe um horário de início válido.');
    inicio = new Date(r.startedAt).toISOString();
  }
  const id = r.id;
  const criada = { id: `audit-${id}-created`, action: 'Consulta criada', detail: 'Consulta lançada.', actor: a.nome, createdAt: agora };
  const item = {
    ...base, id, startedAt: inicio, durationSeconds: 0, status: 'Em curso', attendant: a.nome, commissionRate: dom.comissaoParaNova(taxa, origem),
    awaitingTarologistStart: aguardando, updatedAt: agora, audit: [criada],
  };
  if (aguardando) item.sentToTarologistAt = agora;
  else if (!historico) item.tarologistStartedAt = r.tarologistStartedAt && instanteSensato(r.tarologistStartedAt, agoraMs) ? new Date(r.tarologistStartedAt).toISOString() : inicio;
  if (historico) {
    const fim = Date.parse(r.endedAt);
    if (!Number.isFinite(fim) || fim < Date.parse(inicio) || !instanteSensato(r.endedAt, agoraMs)) throw new dom.RegraConsultaError('Informe um horário de fim válido.');
    const segundos = Math.round(Number(r.durationSeconds));
    if (!Number.isSafeInteger(segundos) || segundos < 0 || segundos > 86400) throw new dom.RegraConsultaError('Informe um tempo válido em minutos.');
    Object.assign(item, { status: r.status, endedAt: new Date(fim).toISOString(), durationSeconds: segundos, tarologistStartedAt: inicio });
    if (r.cancellationReason) item.cancellationReason = dom.observacao(r.cancellationReason, 'Motivo');
    const extra = Array.isArray(r.audit) ? r.audit.slice(1, 8).filter((e) => e && typeof e.id === 'string' && typeof e.action === 'string' && typeof e.detail === 'string') : [];
    item.audit = [criada, ...extra.map((e) => ({ id: String(e.id).slice(0, 160), action: e.action, detail: e.detail.slice(0, 2000), actor: a.nome, createdAt: agora }))];
  }
  return item;
}

module.exports = { montarLancamento, DO_FRONT, HISTORICOS };
