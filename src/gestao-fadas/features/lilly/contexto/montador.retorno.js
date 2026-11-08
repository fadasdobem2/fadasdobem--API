'use strict';

/**
 * `tarologistReturnMetrics` do snapshot (Lilly v708, docs/banco/21 §6): R = % de clientes ÚNICAS que retornaram ao mesmo profissional, entre as
 * clientes únicas atendidas por ele, no histórico FECHADO (até o dia operacional anterior ao de hoje). Três lançamentos de 15 minutos seguidos são
 * um atendimento (`retorno.sessoes.js`). Lê as consultas do banco novo (`gf_consultas_ext`).
 *
 * REGRAS DE OMISSÃO (nunca "0" sem dado): o agregado inteiro sai AUSENTE se a fonte não está liberada, se a leitura estourou o limite ou falhou, se não há
 * sessão alguma no período, ou se ele não passa em `validarAgregado` (o mesmo crivo que a Lilly aplica: `complete`, período fechado, uma linha por
 * profissional, percentual igual às contagens). Profissional sem cliente atendida não ganha linha. Zero comprovado (clients > 0, nenhuma voltou) sai 0.
 *
 * A fonte é só o banco novo: o histórico anterior à virada (legado) não está aqui. Por isso a flag `GF_LILLY_RETORNO_METRICAS_ENABLED` vem DESLIGADA:
 * ligar é decisão de quem confirma que o histórico do banco novo basta (ou que o legado foi importado). Cache curto por dia operacional (o dado é diário).
 */

const { diaOperacionalDe, timestampSaoPaulo, somarDias } = require('../../../_comum/dia-operacional');
const { sessoesDe, linhasPorProfissional } = require('./retorno.sessoes');
const { LimiteExcedido } = require('./contexto.cobertura');

const LIMITE_REGISTROS = 100000;
const VALIDADE_DO_CACHE_MS = 15 * 60 * 1000;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
let cache = null;

const ligado = (env = process.env) => `${env.GF_LILLY_RETORNO_METRICAS_ENABLED || ''}`.trim().toLowerCase() === 'true';
const limparCache = () => { cache = null; };

/** Mesmo crivo da Lilly (`professionalReturnPercentage`), para TODAS as linhas. `true` = o agregado pode sair. */
function validarAgregado(m, { agoraIso, hoje }) {
  if (!m || m.complete !== true || m.metric !== 'returning_clients_percentage' || !Array.isArray(m.rows)) return false;
  const agora = Date.parse(agoraIso); const gerado = Date.parse(m.generatedAt);
  if (!Number.isFinite(agora) || !Number.isFinite(gerado) || gerado > agora) return false;
  if (!DIA.test(m.periodStart || '') || !DIA.test(m.periodEnd || '') || m.periodStart > m.periodEnd || m.periodEnd >= hoje) return false;
  const vistos = new Set();
  for (const r of m.rows) {
    const id = String(r.tarologistId);
    if (!id || vistos.has(id)) return false;
    vistos.add(id);
    if (typeof r.returnPercentage !== 'number' || !Number.isFinite(r.returnPercentage) || r.returnPercentage < 0 || r.returnPercentage > 100) return false;
    if (!Number.isInteger(r.clients) || r.clients <= 0 || !Number.isInteger(r.returningClients) || r.returningClients < 0 || r.returningClients > r.clients) return false;
    if (Math.abs(r.returnPercentage - (r.returningClients / r.clients) * 100) > 0.1) return false;
  }
  return m.rows.length > 0;
}

const diaOperacional = (iso) => diaOperacionalDe(timestampSaoPaulo(new Date(iso)));

function registroDaLinha(l) {
  const item = typeof l.item === 'string' ? JSON.parse(l.item) : l.item || {};
  const iso = (v) => (v ? new Date(v).toISOString() : undefined);
  return {
    id: l.id, tarotId: l.id_tarologo, clientId: l.id_cliente, status: l.status, awaitingTarologistStart: l.aguardando_inicio === true, durationSeconds: Number(l.duracao_segundos),
    startedAt: iso(l.iniciada_em), endedAt: iso(l.encerrada_em),
    continuation: item.continuation || (l.consulta_origem_id ? { kind: 'extension', sourceConsultationId: l.consulta_origem_id } : undefined), coverage: item.coverage,
  };
}

/**
 * @param {{ agora: Date, hoje: string, ligada?: boolean, semCache?: boolean }} p
 * @param {object} f fontes (precisa de `consultasParaRetorno`)
 * @returns {Promise<object|undefined>} o agregado ou `undefined` (omitir; nunca zero inventado)
 */
async function montarRetorno({ agora, hoje, ligada = ligado(), semCache = false }, f) {
  if (!ligada) return undefined;
  if (!semCache && cache && cache.dia === hoje && agora.getTime() - cache.em < VALIDADE_DO_CACHE_MS && agora.getTime() >= cache.em) return cache.valor;
  const linhas = await f.consultasParaRetorno({ limite: LIMITE_REGISTROS });
  if (linhas.length > LIMITE_REGISTROS) throw new LimiteExcedido('tarologistReturnMetrics');
  const fim = somarDias(hoje, -1);
  const sessoes = sessoesDe(linhas.map(registroDaLinha), diaOperacional).filter((s) => s.date <= fim);
  let valor;
  if (sessoes.length) {
    const inicio = sessoes.reduce((menor, s) => (s.date < menor ? s.date : menor), fim);
    const rows = linhasPorProfissional(sessoes, inicio, fim);
    const agregado = { complete: true, metric: 'returning_clients_percentage', generatedAt: agora.toISOString(), periodStart: inicio, periodEnd: fim, rows };
    if (validarAgregado(agregado, { agoraIso: agora.toISOString(), hoje })) valor = agregado;
  }
  if (!semCache) cache = { dia: hoje, em: agora.getTime(), valor };
  return valor;
}

module.exports = { montarRetorno, validarAgregado, limparCache, ligado };
