'use strict';

/**
 * Cotações de consulta da Lilly v710 (docs/banco/22 §4), TODAS derivadas das regras reais do Gestão no momento do contexto (sem tabela, sem segundo
 * livro de saldo). O executor refaz a mesma conta na hora de gravar; o `id` é um hash do que a define, então cotação velha nunca confere.
 *  - `consultationClosingQuotes`: o término da equipe (`consulta-sessao.js#informarTerminoPelaEquipe`, a mesma transição do `finish-by-staff`) é
 *    EXECUTADO em seco sobre a consulta com o tempo apurado (`fechamento.tempo.js`) e o contexto financeiro real. `canCloseAutomatically` só se ele
 *    encerra como "Concluída" sem motivo de conferência (cobertura do excesso, tempo antes do envio, término antecipado); senão `requiresReview:true`.
 *  - `consultationQuotes` (continuação): consulta anterior FECHADA e sem continuação, minutos pedidos pela cliente (evento ou intenção guardada) e
 *    cobertura da cliente (`financeiro-saldo.js#coberturaDaCliente` + `tarifaDeCredito`). `requiresReview` se há outra consulta em curso da cliente
 *    ou o contexto financeiro não pôde ser provado.
 */

const sessao = require('../../../_comum/dominio/consulta-sessao');
const { tempoDoFechamento, ativa, fechada, sha } = require('../v710/fechamento.tempo');

const CINCO_MIN_MS = 5 * 60 * 1000;
const itemDaLinha = (l) => ({ ...(typeof l.item === 'string' ? JSON.parse(l.item) : l.item), id: l.id });
const ehMinutos = (n) => Number.isInteger(n) && n > 0 && n <= 1440;

/** Simula o término da equipe com as regras reais. `{ canCloseAutomatically, covered, requiresReview }`. */
function simularFechamento(linha, minutos, instante, fin) {
  try {
    const novo = sessao.informarTerminoPelaEquipe(itemDaLinha(linha), minutos, 'Lilly', instante, fin ? { payments: fin.payments, consultations: fin.consultations, profile: fin.profile } : undefined);
    const motivos = (novo.tarologistFinishReport && novo.tarologistFinishReport.reviewReasons) || [];
    const automatico = novo.status === 'Concluída' && motivos.length === 0;
    return { canCloseAutomatically: automatico, covered: !motivos.includes('unfunded_extra'), requiresReview: !automatico };
  } catch (_e) {
    return { canCloseAutomatically: false, covered: false, requiresReview: true }; // a regra recusou (ex.: término antecipado sem motivo): conferência humana
  }
}

/** Cotações de fechamento das consultas ATIVAS do snapshot. */
async function cotacoesDeFechamento({ consultas, evento, revisao, agora }, f) {
  const saida = [];
  for (const [i, c] of consultas.consultations.entries()) {
    if (!ativa(c) || c.awaitingTarologistStart) continue;
    const timing = tempoDoFechamento(c, evento);
    if (!timing) continue;
    const linha = consultas.linhas[i];
    const fin = await f.contextoFinanceiro(c.clientId);
    const r = simularFechamento(linha, timing.minutes, evento.at, fin);
    saida.push({
      id: `cq-${sha([c.id, c.version, revisao, timing.minutes, timing.source]).slice(0, 32)}`, current: true, consultationId: c.id, clientId: c.clientId, tarologistId: c.tarologistId,
      revision: revisao, minutes: timing.minutes, ...r, expiresAt: new Date(agora.getTime() + CINCO_MIN_MS).toISOString(),
    });
  }
  return saida;
}

/** Minutos que a cliente pediu: do evento ou da última intenção dela guardada na conversa. `null` se não há como provar. */
async function minutosPedidos(escopo, evento, f, agora) {
  const direto = evento && evento.data && evento.data.minutes;
  if (ehMinutos(direto)) return direto;
  if (!escopo.conversationIds.length) return null;
  const desdeIso = new Date(agora.getTime() - 24 * 3600 * 1000).toISOString();
  const eventos = await f.eventos({ conversationIds: escopo.conversationIds, desdeIso, limite: 200 });
  const pedidos = eventos.filter((e) => e.actor === 'client' && e.internal === false && e.data && ['request_more_time', 'more_time_response'].includes(e.data.intent) && ehMinutos(e.data.minutes));
  return pedidos.length ? pedidos.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0].data.minutes : null;
}

/** Cotações de continuação: uma por consulta FECHADA, sem filha, das clientes em foco. */
async function cotacoesDeContinuacao({ consultas, escopo, focoIds, evento, revisao, agora }, f) {
  const minutos = await minutosPedidos(escopo, evento, f, agora);
  if (!minutos) return [];
  const saida = [];
  for (const c of consultas.consultations) {
    if (!fechada(c) || consultas.consultations.some((o) => o.continuation && o.continuation.sourceConsultationId === c.id)) continue;
    if (!focoIds.includes(c.clientId) && escopo.consultationId !== c.id) continue;
    const fin = await f.contextoFinanceiro(c.clientId);
    const outra = consultas.consultations.some((o) => o.id !== c.id && o.clientId === c.clientId && ativa(o));
    const provado = Boolean(fin);
    const cobre = provado && (fin.resumo.postpaid || fin.resumo.availableMinutes + fin.resumo.benefitMinutes >= minutos);
    saida.push({
      id: `cc-${sha([c.id, c.version, revisao, minutos]).slice(0, 32)}`, current: true, sourceConsultationId: c.id, clientId: c.clientId, tarologistId: c.tarologistId, revision: revisao,
      minutes: minutos, covered: Boolean(cobre), canLaunch: Boolean(cobre && fin.resumo.canLaunch), requiresReview: !provado || outra, expiresAt: new Date(agora.getTime() + CINCO_MIN_MS).toISOString(),
    });
  }
  return saida;
}

module.exports = { cotacoesDeFechamento, cotacoesDeContinuacao, simularFechamento, minutosPedidos };
