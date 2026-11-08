'use strict';

/**
 * `open_continuation` (Lilly v710, docs/banco/22 §6): abre OUTRA consulta ligada à anterior (`continuation.sourceConsultationId`, a anterior fica intacta),
 * pelo serviço EXISTENTE de lançamento (`POST /consultations`, `ciclo.service.js#lancar`: ocupação, reserva de continuação, turno, comissão, auditoria). A
 * cobertura é a do Gestão (`financeiro-saldo.js`, cotação refeita aqui); nenhum segundo livro de saldo e nenhum valor inventado.
 * DESLIGADA por padrão (`GF_LILLY_CONTINUACAO_ENABLED`; a Lilly tem a sua, `consultationActions.continuationEnabled`).
 * Antes: revisão do snapshot; impressão da anterior; consulta anterior FECHADA, da mesma cliente e tarólogo, sem filha; cadeia íntegra (mesma
 * `chainMinutes` da Lilly); nenhuma outra consulta aberta/encaminhada da cliente ou do tarólogo; cotação refeita (id, minutos, cobertura, `canLaunch`);
 * vínculo ativo da conversa da cliente; evento de origem guardado.
 */

const ciclo = require('../../consultas-ciclo/ciclo.service');
const { registrar } = require('../acoes/acoes.registro');
const leituras = require('../dados/leituras.v710');
const vinculos = require('../dados/vinculos.repo');
const { conferirBaseComVinculo, permitido, nao } = require('./validacao.base');
const { recusar, ehObjeto, texto, chaveDaOperacao, pedidoDeServico, chamarServico, auditar } = require('./executores.comum');
const cfg = require('./executores.config');
const v = require('../v710/comum');
const { fechada } = require('../v710/fechamento.tempo');
const { cadeiaDeMinutos } = require('../v710/cadeia');
const { traduzirStatus } = require('../contexto/montador.consultas');
const { revisaoAtual } = require('../contexto/revisao');
const { avulso } = require('../dados/executor');

function normalizar(acao) {
  const p = ehObjeto(acao.payload) ? acao.payload : null;
  if (!p) return { motivo: 'A ação não traz os dados da continuação.' };
  const sourceConsultationId = texto(p.sourceConsultationId);
  if (!v.ID.test(sourceConsultationId)) return { motivo: 'Informe a consulta anterior.' };
  if (!Number.isSafeInteger(p.expectedRevision)) return { motivo: 'A ação precisa da revisão lida no contexto (expectedRevision, inteiro).' };
  if (typeof p.expectedConsultation !== 'string' || !p.expectedConsultation || typeof p.expectedChain !== 'string' || !p.expectedChain) return { motivo: 'A ação precisa das impressões da consulta e da cadeia.' };
  if (!Number.isInteger(p.minutes) || p.minutes < 1 || p.minutes > 1440) return { motivo: 'Informe os minutos da continuação (inteiro).' };
  if (!texto(p.quoteId)) return { motivo: 'A ação precisa da cotação da continuação (quoteId).' };
  const sourceConversationId = texto(p.sourceConversationId);
  if (!sourceConversationId) return { motivo: 'A ação precisa da conversa da cliente (sourceConversationId).' };
  const triggerEventId = texto(p.triggerEventId);
  if (!triggerEventId) return { motivo: 'A ação precisa do evento de origem.' };
  if (p.clientId !== undefined && `${p.clientId}` !== `${acao.clientId}`) return { motivo: 'A cliente da continuação não confere com a da ação.' };
  if (p.tarologistId !== undefined && `${p.tarologistId}` !== `${acao.tarologistId}`) return { motivo: 'O tarólogo da continuação não confere com o da ação.' };
  return { sourceConsultationId, rootConsultationId: texto(p.rootConsultationId), expectedRevision: p.expectedRevision, expectedConsultation: p.expectedConsultation, expectedChain: p.expectedChain, minutes: p.minutes, quoteId: texto(p.quoteId), sourceConversationId, triggerEventId };
}

async function avaliar(acao, executor) {
  const ruim = (code, motivo, status = 422) => ({ recusa: { code, motivo, status } });
  if (!cfg.continuacaoLigada()) return ruim('LILLY_CONTINUATION_DISABLED', 'A abertura de continuação pela Lilly está desligada neste ambiente.', 403);
  const n = normalizar(acao);
  if (n.motivo) return ruim('INVALID_INPUT', n.motivo);
  const { recusa } = await conferirBaseComVinculo(acao, { exigirCliente: true, vinculoOpcional: true, exigirTarologo: true, exigirConta: true, executor });
  if (recusa) return ruim('LILLY_CONTINUATION_NOT_ALLOWED', recusa.reason);
  const vinculo = await vinculos.buscarAtivoDaConversa(executor, n.sourceConversationId);
  if (!vinculo || vinculo.clientId !== `${acao.clientId}`) return ruim('LILLY_CONTINUATION_NOT_ALLOWED', 'A conversa da cliente não está vinculada a esta cliente (vínculo ativo e verificado).');
  try {
    await v.provarOrigem(executor, { ref: n.triggerEventId, tipo: 'nenhum' });
    await v.exigirRevisao(n.expectedRevision);
  } catch (e) { if (e && e.code) return ruim(e.code, e.message, e.status); throw e; }
  const linha = await leituras.consultaPorId(n.sourceConsultationId);
  if (!linha) return ruim('LILLY_CONSULTATION_NOT_FOUND', 'Consulta anterior não encontrada.', 404);
  if (linha.id_cliente !== `${acao.clientId}` || linha.id_tarologo !== `${acao.tarologistId}`) return ruim('LILLY_CONSULTATION_MISMATCH', 'A consulta anterior não é desta cliente e deste tarólogo.');
  const row = v.consultaDoContexto(linha);
  if (!fechada(row)) return ruim('LILLY_STATE_CHANGED', 'A consulta anterior ainda não está fechada.', 409);
  if (v.impressaoDaLinha(row) !== n.expectedConsultation) return ruim('LILLY_CONSULTATION_CHANGED', 'A consulta anterior mudou desde a leitura da Lilly.', 409);
  if ((await leituras.continuacoesDe(row.id)).length) return ruim('LILLY_STATE_CHANGED', 'Esta consulta já tem uma continuação.', 409);
  const ocupadas = (await leituras.consultasAbertas({ tarotId: linha.id_tarologo, clientId: linha.id_cliente })).filter((c) => c.id !== linha.id);
  if (ocupadas.length) return ruim('LILLY_STATE_CHANGED', 'Já existe outra consulta encaminhada ou em andamento.', 409);
  const todas = (await leituras.consultasDaCliente(linha.id_cliente)).map(v.consultaDoContexto);
  const cadeia = cadeiaDeMinutos(todas, row);
  if (!cadeia || cadeia.fingerprint !== n.expectedChain || (n.rootConsultationId && cadeia.rootConsultationId !== n.rootConsultationId)) return ruim('LILLY_CHAIN_CHANGED', 'O saldo ou as condições da continuação mudaram.', 409);
  const fin = await require('../contexto/fontes').fontes().contextoFinanceiro(linha.id_cliente);
  const cobre = Boolean(fin) && (fin.resumo.postpaid || fin.resumo.availableMinutes + fin.resumo.benefitMinutes >= n.minutes);
  const id = `cc-${v.sha([row.id, row.version, n.expectedRevision, n.minutes]).slice(0, 32)}`;
  if (id !== n.quoteId) return ruim('LILLY_QUOTE_CHANGED', 'A cotação da continuação não confere com a atual.', 409);
  if (!cobre || !fin.resumo.canLaunch) return ruim('LILLY_NOT_COVERED', 'O saldo não cobre esta continuação. Confira o pagamento antes de abrir.', 409);
  return { n, linha, row };
}

function registrarContinuacao() {
  registrar('open_continuation', {
    async validar(acao) {
      const r = await avaliar(acao, avulso);
      return r.recusa ? nao(r.recusa.motivo) : permitido(acao);
    },
    async executar(acao, { executor, chave }) {
      const r = await avaliar(acao, executor);
      if (r.recusa) recusar(r.recusa.code, r.recusa.motivo, r.recusa.status);
      const { n, linha } = r;
      const origem = { ...(typeof linha.item === 'string' ? JSON.parse(linha.item) : linha.item) };
      const novoId = `CL-${v.sha(chave.interna).slice(0, 40)}`;
      const resp = await chamarServico(() => ciclo.lancar(pedidoDeServico({
        body: {
          operationKey: chaveDaOperacao(chave, 'continuacao'),
          record: { id: novoId, clientId: linha.id_cliente, client: origem.client, tarotId: linha.id_tarologo, tarot: origem.tarot, channel: origem.channel, paymentProfile: origem.paymentProfile, expectedMinutes: n.minutes, continuation: { sourceConsultationId: linha.id } },
        },
      })));
      const criada = resp.consultations.find((x) => x.id === novoId);
      const depois = await leituras.consultaPorId(novoId);
      const resultado = {
        id: novoId, consultationId: novoId, sourceConsultationId: linha.id, status: traduzirStatus(depois), minutes: n.minutes, version: Number(depois.version), revision: await revisaoAtual(),
      };
      await auditar(executor, chave, {
        acao: 'open_continuation', entidade: 'consulta', entidadeId: novoId, antes: { sourceConsultationId: linha.id, sourceVersion: Number(linha.version) },
        depois: { ...resultado, quoteId: n.quoteId, createdAt: criada && criada.startedAt, sourceEventId: n.triggerEventId, conversationId: acao.conversationId },
      });
      return resultado;
    },
  });
}

module.exports = { registrarContinuacao, normalizar };
