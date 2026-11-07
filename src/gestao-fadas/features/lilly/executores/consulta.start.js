'use strict';

/**
 * `start_consultation` (Maturacao/59, R11; Maturacao/60, item 8): inicia pelo serviço EXISTENTE (`POST /consultations/:id/start`, o caminho
 * da equipe: ocupação, reserva de continuação e turno confirmado repetidos pelo serviço). NÃO cria consulta nem lança pagamento.
 *  - a consulta existe, é da cliente e do tarólogo da ação, está PREPARADA (`consultas/status.js`) e na versão esperada;
 *  - o relógio é o do SERVIDOR: `startedAt` devolvido é o gravado pelo serviço, nunca o horário da mensagem (que vai para a auditoria);
 *  - mensagem anterior à preparação não inicia; consulta já iniciada = 409 `LILLY_STATE_CHANGED` com o `startedAt` real (não reinicia o relógio);
 *  - responde só depois do commit da transação do serviço (a confirmação sai da guarda, depois do efeito).
 * NÃO RESPONDIDO: conferir `expectedVersion` na MESMA transação do início (o serviço não aceita versão): a leitura é logo antes da chamada.
 */

const ciclo = require('../../consultas-ciclo/ciclo.service');
const { traduzirStatusConsulta } = require('../consultas/status');
const { hojeOperacional } = require('../../../_comum/dia-operacional');
const { registrar } = require('../acoes/acoes.registro');
const { conferirBaseComVinculo, permitido, nao } = require('./validacao.base');
const { recusar, ehObjeto, texto, chaveDaOperacao, pedidoDeServico, chamarServico, auditar } = require('./executores.comum');
const { avulso } = require('../dados/executor');

const PREPARADA = new Set(['prepared', 'ready', 'pending_start']);
const ID = /^[A-Za-z0-9._:-]{1,64}$/;
const instante = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null);

function normalizar(acao) {
  const p = ehObjeto(acao.payload) ? acao.payload : null;
  if (!p) return { motivo: 'A ação não traz os dados do início.' };
  const consultationId = texto(p.consultationId);
  if (!ID.test(consultationId)) return { motivo: 'Informe a consulta.' };
  if (p.clientId !== undefined && `${p.clientId}` !== `${acao.clientId}`) return { motivo: 'A cliente do início não confere com a da ação.' };
  if (p.tarologistId !== undefined && `${p.tarologistId}` !== `${acao.tarologistId}`) return { motivo: 'O tarólogo do início não confere com o da ação.' };
  if (p.sourceConversationId !== undefined && p.sourceConversationId !== acao.conversationId) return { motivo: 'A conversa do início não confere com a da ação.' };
  if (!PREPARADA.has(texto(p.expectedStatus))) return { motivo: 'Só uma consulta preparada pode ser iniciada.' };
  if (p.expectedVersion !== undefined && p.expectedVersion !== null && (!Number.isInteger(p.expectedVersion) || p.expectedVersion < 1)) return { motivo: 'A versão esperada é inválida.' };
  if (p.startedAt !== undefined && instante(p.startedAt) === null) return { motivo: 'O horário da mensagem é inválido.' };
  return { consultationId, expectedVersion: p.expectedVersion ?? undefined, mensagemEm: instante(p.startedAt) };
}

async function lerConsulta(executor, id) {
  const [linhas] = await executor.execute('SELECT id, id_tarologo, id_cliente, status, item, version FROM gf_consultas_ext WHERE id = ?', [id]);
  const l = linhas[0];
  if (!l) return null;
  const item = typeof l.item === 'string' ? JSON.parse(l.item) : l.item;
  return { id: l.id, tarotId: l.id_tarologo, clientId: l.id_cliente, version: Number(l.version), item: { ...item, id: l.id, status: l.status } };
}

/** Confere a consulta contra a ação. `{ motivo, code, status }` ou `{ consulta }`. */
async function conferir(executor, acao, n, agora = new Date()) {
  const c = await lerConsulta(executor, n.consultationId);
  if (!c) return { motivo: 'Consulta não encontrada.', code: 'LILLY_CONSULTATION_NOT_FOUND', status: 404 };
  if (c.clientId !== `${acao.clientId}` || c.tarotId !== `${acao.tarologistId}`) return { motivo: 'A consulta não é desta cliente e deste tarólogo.', code: 'LILLY_CONSULTATION_MISMATCH', status: 422 };
  const status = traduzirStatusConsulta({ status: c.item.status, awaitingTarologistStart: c.item.awaitingTarologistStart });
  if (status !== 'prepared') {
    const quando = c.item.tarologistStartedAt || c.item.startedAt;
    return { motivo: `A consulta não está preparada para iniciar (situação: ${status})${status === 'in_progress' && quando ? `; já iniciada em ${quando}` : ''}.`, code: 'LILLY_STATE_CHANGED', status: 409 };
  }
  if (n.expectedVersion !== undefined && n.expectedVersion !== c.version) return { motivo: 'A consulta mudou desde a leitura da Lilly.', code: 'LILLY_VERSION_CHANGED', status: 409 };
  const preparada = Date.parse(c.item.sentToTarologistAt || c.item.startedAt || '');
  if (n.mensagemEm !== null && Number.isFinite(preparada) && n.mensagemEm < preparada) return { motivo: 'A mensagem é anterior à preparação da consulta.', code: 'LILLY_STATE_CHANGED', status: 409 };
  if (Number.isFinite(preparada) && hojeOperacional(new Date(preparada)) !== hojeOperacional(agora)) return { motivo: 'A consulta preparada é de outro dia operacional.', code: 'LILLY_STATE_CHANGED', status: 409 };
  return { consulta: c };
}

function registrarStartConsultation() {
  registrar('start_consultation', {
    async validar(acao) {
      const n = normalizar(acao); if (n.motivo) return nao(n.motivo);
      const { recusa } = await conferirBaseComVinculo(acao, { exigirCliente: true, exigirVinculo: true, exigirTarologo: true, exigirConta: true });
      if (recusa) return recusa;
      const c = await conferir(avulso, acao, n); if (c.motivo) return nao(c.motivo);
      return permitido(acao);
    },
    async executar(acao, { executor, chave }) {
      const n = normalizar(acao); if (n.motivo) recusar('INVALID_INPUT', n.motivo);
      const { recusa } = await conferirBaseComVinculo(acao, { exigirCliente: true, exigirVinculo: true, exigirTarologo: true, exigirConta: true, executor });
      if (recusa) recusar('LILLY_START_NOT_ALLOWED', recusa.reason);
      const c = await conferir(executor, acao, n); if (c.motivo) recusar(c.code, c.motivo, c.status);
      const r = await chamarServico(() => ciclo.iniciar(pedidoDeServico({ params: { id: n.consultationId }, body: { operationKey: chaveDaOperacao(chave, 'inicio') } })));
      const item = r.consultations.find((x) => x.id === n.consultationId);
      const startedAt = new Date(Date.parse(item.tarologistStartedAt || item.startedAt)).toISOString();
      const version = r.versions[n.consultationId];
      await auditar(executor, chave, {
        acao: 'start_consultation', entidade: 'consulta', entidadeId: n.consultationId, antes: { version: c.consulta.version },
        depois: { version, startedAt, messageStartedAt: n.mensagemEm === null ? undefined : new Date(n.mensagemEm).toISOString(), sourceEventId: acao.payload.sourceEventId, conversationId: acao.conversationId },
      });
      return { id: n.consultationId, consultationId: n.consultationId, startedAt, status: 'in_progress', version };
    },
  });
}

module.exports = { registrarStartConsultation, normalizar };
