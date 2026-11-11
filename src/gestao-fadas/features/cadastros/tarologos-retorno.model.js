'use strict';

/** Agregado de todo o histórico, com as mesmas sessões/continuações da tela aprovada.
 * Só as contagens por profissional saem do servidor; dinheiro e dados pessoais não participam.
 */
const { lerConsultaLegado } = require('../consultas/helpers/leitura-legado');
const { timestampSaoPaulo, diaOperacionalDe } = require('../../_comum/dia-operacional');
const { sessoesDe, linhasPorProfissional } = require('../lilly/contexto/retorno.sessoes');

const iso = (v) => v && Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString() : undefined;
function instanteLocal(local) {
  for (const offset of ['-03:00', '-02:00']) {
    const at = new Date(`${local.slice(0, 19)}${offset}`);
    if (Number.isFinite(at.getTime()) && timestampSaoPaulo(at) === local.slice(0, 19)) return at.toISOString();
  }
  return new Date(`${local.slice(0, 19)}-03:00`).toISOString();
}
function doLegado(linha, agora = new Date()) {
  const l = lerConsultaLegado(linha);
  if (!l.clientId || !l.tarotId || !l.startedAtLocal) return null;
  const finalizada = l.endedAtLocal !== null && l.recordedMinutes !== null;
  const startedAt = instanteLocal(l.startedAtLocal);
  // Mesma duração decorrida de legacyToOperational/legacyElapsedSeconds: minutos inteiros
  // do relógio do servidor. É só evidência de início para a métrica; nunca minutagem cobrada.
  const decorrida = Math.max(0, Math.floor((agora.getTime() - Date.parse(startedAt)) / 60000)) * 60;
  return { id: `legado:${l.id}`, legacyConsultationId: l.id, clientId: l.clientId, tarotId: l.tarotId,
    startedAt, endedAt: finalizada ? instanteLocal(l.endedAtLocal) : undefined,
    durationSeconds: finalizada ? l.recordedMinutes * 60 : decorrida, status: finalizada ? 'Concluída' : 'Em curso' };
}
function doNovo(l) {
  const item = typeof l.item === 'string' ? JSON.parse(l.item) : l.item || {};
  return { ...item, id: String(l.id), clientId: String(l.id_cliente), tarotId: String(l.id_tarologo), status: l.status,
    legacyConsultationId: l.id_consulta_legado || item.legacyConsultationId || undefined,
    awaitingTarologistStart: l.aguardando_inicio === true, durationSeconds: Number(l.duracao_segundos),
    // O leitor operacional entrega o JSON item: preserve sua representação do relógio
    // para o fallback por minuto ter a mesma semântica de mergeConsultations.
    startedAt: typeof item.startedAt === 'string' ? item.startedAt : iso(l.iniciada_em),
    endedAt: typeof item.endedAt === 'string' ? item.endedAt : iso(l.encerrada_em),
    continuation: item.continuation || (l.consulta_origem_id ? { kind: 'extension', sourceConsultationId: l.consulta_origem_id } : undefined) };
}
const minuto = (r) => `${r.clientId}|${r.tarotId}|${(r.startedAt || '').slice(0, 16)}`;
/** Mesmo mergeConsultations do front: vínculo explícito vence; sem vínculo, mesmo par e minuto não é outro atendimento. */
function unir(novas, antigas) {
  const atuais = [...new Map(novas.filter((r) => !r.id.startsWith('legado:')).map((r) => [r.id, r])).values()];
  const ids = new Set(atuais.map((r) => r.legacyConsultationId).filter(Boolean).map(String));
  const semVinculo = new Set(atuais.filter((r) => !r.legacyConsultationId && r.clientId && r.tarotId).map(minuto));
  const vistas = new Set();
  return [...atuais, ...antigas.filter((r) => {
    if (vistas.has(r.id)) return false; vistas.add(r.id);
    return !ids.has(r.legacyConsultationId) && !semVinculo.has(minuto(r));
  })];
}
const diaDe = (valor) => diaOperacionalDe(timestampSaoPaulo(new Date(valor)));
function agregadoDeRegistros(registros, agora) {
  const fim = diaDe(agora.toISOString());
  const sessoes = sessoesDe(registros, diaDe).filter((s) => s.date <= fim);
  const inicio = sessoes.reduce((menor, s) => s.date < menor ? s.date : menor, fim);
  return { readAt: agora.toISOString(), generatedAt: agora.toISOString(), complete: true, metric: 'returning_clients_percentage',
    periodStart: inicio, periodEnd: fim, rows: linhasPorProfissional(sessoes, inicio, fim) };
}
function montar(novas, antigas, agora = new Date()) {
  return agregadoDeRegistros(unir(novas.map(doNovo), antigas.map((linha) => doLegado(linha, agora)).filter(Boolean)), agora);
}
module.exports = { instanteLocal, doLegado, doNovo, unir, agregadoDeRegistros, montar };
