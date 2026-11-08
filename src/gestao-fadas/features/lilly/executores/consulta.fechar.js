'use strict';

/**
 * `close_consultation` (Lilly v710, docs/banco/22 §6), pelo serviço EXISTENTE do término pela equipe (`POST /consultations/:id/finish-by-staff`,
 * `consultas-ciclo/ciclo.service.js#informarTerminoPelaEquipe`: o mesmo domínio, saldo real e histórico). NÃO cria segundo livro de saldo nem calcula valor.
 * DESLIGADA por padrão (`GF_LILLY_FECHAR_CONSULTA_ENABLED`; a Lilly tem a sua, `consultationActions.closeEnabled`).
 * Antes: revisão do snapshot; impressão da consulta (sha256 do JSON da linha do contexto); tempo REAPURADO (pausas incluídas, minutos comprados nunca
 * são relógio) igual ao do payload; cotação refeita com as regras reais (id, `canCloseAutomatically`, cobertura, sem conferência); consulta em curso e
 * iniciada; sem pedido de mais tempo ativo; evento de origem guardado. Recusa definitiva 4xx; `committed:true` só depois do commit do serviço.
 */

const ciclo = require('../../consultas-ciclo/ciclo.service');
const sessao = require('../../../_comum/dominio/consulta-sessao');
const { registrar } = require('../acoes/acoes.registro');
const leituras = require('../dados/leituras.v710');
const { conferirBaseComVinculo, permitido, nao } = require('./validacao.base');
const { recusar, ehObjeto, texto, chaveDaOperacao, pedidoDeServico, chamarServico, auditar } = require('./executores.comum');
const cfg = require('./executores.config');
const v = require('../v710/comum');
const { tempoDoFechamento, ativa } = require('../v710/fechamento.tempo');
const { simularFechamento } = require('../contexto/cotacoes.consulta');
const { traduzirStatus } = require('../contexto/montador.consultas');
const { revisaoAtual } = require('../contexto/revisao');
const { avulso } = require('../dados/executor');

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function normalizar(acao) {
  const p = ehObjeto(acao.payload) ? acao.payload : null;
  if (!p) return { motivo: 'A ação não traz os dados do fechamento.' };
  const consultationId = texto(p.consultationId);
  if (!v.ID.test(consultationId)) return { motivo: 'Informe a consulta.' };
  if (!Number.isSafeInteger(p.expectedRevision)) return { motivo: 'A ação precisa da revisão lida no contexto (expectedRevision, inteiro).' };
  if (typeof p.expectedConsultation !== 'string' || !p.expectedConsultation) return { motivo: 'A ação precisa da impressão da consulta (expectedConsultation).' };
  if (!texto(p.quoteId)) return { motivo: 'A ação precisa da cotação de fechamento (quoteId).' };
  if (!ehObjeto(p.timing) || !Number.isFinite(p.timing.minutes) || !['reported', 'registered_clock'].includes(p.timing.source)) return { motivo: 'A ação precisa do tempo apurado (timing).' };
  if (!Number.isFinite(Date.parse(p.sourceAt))) return { motivo: 'sourceAt inválido.' };
  const triggerEventId = texto(p.triggerEventId);
  if (!triggerEventId) return { motivo: 'A ação precisa do evento que pediu o fechamento.' };
  if (p.clientId !== undefined && `${p.clientId}` !== `${acao.clientId}`) return { motivo: 'A cliente do fechamento não confere com a da ação.' };
  if (p.tarologistId !== undefined && `${p.tarologistId}` !== `${acao.tarologistId}`) return { motivo: 'O tarólogo do fechamento não confere com o da ação.' };
  return { consultationId, expectedRevision: p.expectedRevision, expectedConsultation: p.expectedConsultation, quoteId: texto(p.quoteId), timing: p.timing, sourceAt: p.sourceAt, triggerEventId };
}

async function avaliar(acao, executor) {
  const ruim = (code, motivo, status = 422) => ({ recusa: { code, motivo, status } });
  if (!cfg.fecharConsultaLigado()) return ruim('LILLY_CLOSE_DISABLED', 'O fechamento de consulta pela Lilly está desligado neste ambiente.', 403);
  const n = normalizar(acao);
  if (n.motivo) return ruim('INVALID_INPUT', n.motivo);
  const { recusa } = await conferirBaseComVinculo(acao, { exigirCliente: true, vinculoOpcional: true, exigirTarologo: true, exigirConta: true, executor });
  if (recusa) return ruim('LILLY_CLOSE_NOT_ALLOWED', recusa.reason);
  try {
    const e = await v.provarOrigem(executor, { ref: n.triggerEventId, tipo: 'nenhum', clientId: undefined, conversationId: texto(acao.conversationId) });
    if (e.internal) return ruim('LILLY_SOURCE_MISMATCH', 'O evento de origem do fechamento precisa ser uma mensagem pública.');
    await v.exigirRevisao(n.expectedRevision);
  } catch (e) { if (e && e.code) return ruim(e.code, e.message, e.status); throw e; }
  const linha = await leituras.consultaPorId(n.consultationId);
  if (!linha) return ruim('LILLY_CONSULTATION_NOT_FOUND', 'Consulta não encontrada.', 404);
  if (linha.id_cliente !== `${acao.clientId}` || linha.id_tarologo !== `${acao.tarologistId}`) return ruim('LILLY_CONSULTATION_MISMATCH', 'A consulta não é desta cliente e deste tarólogo.');
  const row = v.consultaDoContexto(linha);
  if (!ativa(row) || row.awaitingTarologistStart) return ruim('LILLY_STATE_CHANGED', 'A consulta não está em andamento.', 409);
  if (v.impressaoDaLinha(row) !== n.expectedConsultation) return ruim('LILLY_CONSULTATION_CHANGED', 'A consulta mudou desde a leitura da Lilly.', 409);
  const item = { ...(typeof linha.item === 'string' ? JSON.parse(linha.item) : linha.item), id: linha.id };
  if (sessao.temPedidoDeMaisTempo(item)) return ruim('LILLY_STATE_CHANGED', 'Há um pedido de mais tempo pendente nesta consulta.', 409);
  const timing = tempoDoFechamento(row, { at: n.sourceAt, data: n.timing.source === 'reported' ? { minutes: n.timing.minutes } : {} });
  if (!timing || !igual(timing, n.timing)) return ruim('LILLY_TIMING_CHANGED', 'O tempo, as pausas ou a conferência financeira mudaram.', 409);
  const fin = await require('../contexto/fontes').fontes().contextoFinanceiro(row.clientId);
  const r = simularFechamento(linha, timing.minutes, n.sourceAt, fin);
  const id = `cq-${v.sha([row.id, row.version, n.expectedRevision, timing.minutes, timing.source]).slice(0, 32)}`;
  if (id !== n.quoteId) return ruim('LILLY_QUOTE_CHANGED', 'A cotação de fechamento não confere com a atual.', 409);
  if (!r.canCloseAutomatically || !r.covered || r.requiresReview) return ruim('LILLY_REVIEW_REQUIRED', 'O fechamento precisa de conferência da equipe antes de ser gravado.', 409);
  return { n, linha, row, timing };
}

function registrarFecharConsulta() {
  registrar('close_consultation', {
    async validar(acao) {
      const r = await avaliar(acao, avulso);
      return r.recusa ? nao(r.recusa.motivo) : permitido(acao);
    },
    async executar(acao, { executor, chave }) {
      const r = await avaliar(acao, executor);
      if (r.recusa) recusar(r.recusa.code, r.recusa.motivo, r.recusa.status);
      const { n, linha, timing } = r;
      const resp = await chamarServico(() => ciclo.informarTerminoPelaEquipe(pedidoDeServico({
        params: { id: n.consultationId }, body: { operationKey: chaveDaOperacao(chave, 'fechamento'), minutes: timing.minutes, timingConfirmed: true },
      })));
      const item = resp.consultations.find((x) => x.id === n.consultationId);
      const depois = await leituras.consultaPorId(n.consultationId);
      const linhaDepois = v.consultaDoContexto(depois);
      const resultado = {
        id: n.consultationId, consultationId: n.consultationId, status: traduzirStatus(depois), endedAt: linhaDepois.endedAt, durationSeconds: item.durationSeconds,
        minutes: timing.minutes, version: Number(depois.version), revision: await revisaoAtual(),
      };
      await auditar(executor, chave, {
        acao: 'close_consultation', entidade: 'consulta', entidadeId: n.consultationId, antes: { version: Number(linha.version), status: linha.status },
        depois: { ...resultado, quoteId: n.quoteId, sourceEventId: n.triggerEventId, conversationId: acao.conversationId },
      });
      return resultado;
    },
  });
}

module.exports = { registrarFecharConsulta, normalizar };
