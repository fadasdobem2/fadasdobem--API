'use strict';

/**
 * `consultations` do snapshot (Maturacao/59, 3.5; Maturacao/60, seção 8 e 10): `gf_consultas_ext` no vocabulário da Lilly.
 *  - Quais: todas as ABERTAS (qualquer tarólogo: ocupação e fila), as iniciadas hoje (dia operacional), as das clientes em foco nos últimos
 *    45 dias e a citada no evento. Mais que `CONSULTAS` = assunto incompleto (vazio).
 *  - Status por `consultas/status.js` (`traduzirStatusConsulta`) com os ajustes do doc 60 §10: `Finalizada pelo tarólogo` = `ended`
 *    (aguarda a revisão da equipe) e `Anulada` = `cancelled` (nunca `completed`).
 *  - PREPARADA (`prepared`): sem `startedAt` (a Lilly recusa iniciar consulta que já tem `startedAt`); só `preparedAt`/`sentToTarologistAt`.
 *  - Canal traduzido (`consultas.canal.js`). Minutos: limite máximo da consulta; consulta livre (pós-paga sem limite) fica sem `minutes`.
 *  - Nada de observação, comissão, valor ou auditoria.
 */

const { LIMITES } = require('./contexto.limites');
const { LimiteExcedido } = require('./contexto.cobertura');
const { traduzirStatusConsulta } = require('../consultas/status');
const { traduzirCanal } = require('./consultas.canal');

const sem = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const item = (linha) => (typeof linha.item === 'string' ? JSON.parse(linha.item) : linha.item || {});
const iso = (v) => (v ? new Date(v).toISOString() : undefined);
const DIA_MS = 24 * 3600 * 1000;

const AJUSTES_DO_PAINEL = Object.freeze({ Anulada: 'cancelled', 'Finalizada pelo tarólogo': 'ended' });

function traduzirStatus(linha) {
  if (Object.prototype.hasOwnProperty.call(AJUSTES_DO_PAINEL, linha.status)) return AJUSTES_DO_PAINEL[linha.status];
  return traduzirStatusConsulta({ status: linha.status, awaitingTarologistStart: linha.aguardando_inicio !== false });
}

function minutosDe(i) {
  if (i.timeLimit && i.timeLimit.kind === 'maximum' && Number.isSafeInteger(i.timeLimit.minutes) && i.timeLimit.minutes > 0) return i.timeLimit.minutes;
  return Number.isSafeInteger(i.expectedMinutes) && i.expectedMinutes > 0 ? i.expectedMinutes : undefined;
}

const pausas = (i) => (Array.isArray(i.pauseHistory) ? i.pauseHistory.filter((p) => p && p.startedAt).map((p) => sem({ startedAt: iso(p.startedAt), endedAt: iso(p.endedAt) })) : undefined);

/** `billing.funding[]` (v710): só quais pagamentos financiam a consulta e quantos minutos cada um atribuiu (`paymentId`, `minutes`). Sem valores. */
function financiamento(i) {
  const lotes = i.billing && Array.isArray(i.billing.funding) ? i.billing.funding : null;
  if (!lotes) return undefined;
  const util = lotes.filter((x) => x && typeof x.paymentId === 'string' && x.paymentId && Number.isFinite(x.minutes) && x.minutes > 0).map((x) => ({ paymentId: x.paymentId, minutes: x.minutes }));
  return util.length ? { funding: util } : undefined;
}

function linhaParaConsulta(l) {
  const i = item(l);
  const status = traduzirStatus(l);
  const preparada = status === 'prepared';
  const encerrada = status === 'ended' || status === 'completed';
  const relatorio = i.tarologistFinishReport && typeof i.tarologistFinishReport === 'object' ? i.tarologistFinishReport : null;
  return sem({
    id: l.id,
    clientId: l.id_cliente,
    tarologistId: l.id_tarologo,
    status,
    version: Number(l.version),
    createdAt: iso(l.criado_em),
    preparedAt: preparada ? iso(i.sentToTarologistAt || l.iniciada_em) : undefined,
    startedAt: preparada ? undefined : iso(l.tarologo_iniciou_em || l.iniciada_em),
    endedAt: iso(l.encerrada_em || (relatorio && relatorio.endedAt)),
    channel: traduzirCanal(l.canal || i.channel),
    minutes: minutosDe(i),
    appointmentId: l.id_agenda || undefined,
    awaitingTarologistStart: l.aguardando_inicio !== false,
    sentToTarologistAt: iso(i.sentToTarologistAt),
    tarologistStartedAt: iso(l.tarologo_iniciou_em),
    pauseHistory: pausas(i),
    durationSeconds: encerrada ? Number(l.duracao_segundos) : undefined,
    performedDurationSeconds: encerrada && Number.isFinite(i.performedDurationSeconds) ? i.performedDurationSeconds : undefined,
    tarologistFinishReport: relatorio && Number.isFinite(relatorio.minutes) ? sem({ minutes: relatorio.minutes, endedAt: iso(relatorio.endedAt) }) : undefined,
    continuation: l.consulta_origem_id ? { sourceConsultationId: l.consulta_origem_id } : undefined,
    billing: financiamento(i),
  });
}

/** @returns {{ linhas: object[], consultations: object[], clientIds: string[], tarologistIds: string[], ids: string[] }} */
async function montarConsultas({ agora, inicioDoDiaIso, focoIds, consultationId }, f) {
  const desdeIso = new Date(agora.getTime() - LIMITES.JANELA_CONSULTAS_DIAS * DIA_MS).toISOString();
  const linhas = await f.consultas({ clientIds: focoIds, desdeIso, inicioDiaIso: inicioDoDiaIso, consultaId: consultationId, limite: LIMITES.CONSULTAS });
  if (linhas.length > LIMITES.CONSULTAS) throw new LimiteExcedido('consultations');
  return {
    linhas,
    consultations: linhas.map(linhaParaConsulta),
    clientIds: [...new Set(linhas.map((l) => `${l.id_cliente}`))],
    tarologistIds: [...new Set(linhas.map((l) => `${l.id_tarologo}`))],
    ids: linhas.map((l) => `${l.id}`),
  };
}

module.exports = { montarConsultas, linhaParaConsulta, traduzirStatus };
