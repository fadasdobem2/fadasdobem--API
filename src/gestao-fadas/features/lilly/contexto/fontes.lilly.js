'use strict';

/**
 * Leituras das tabelas `gf_lilly_*` para o snapshot (só SELECT, pelo executor avulso de `dados/`). As listas por conversa reaproveitam os
 * repositórios de `dados/` (avisos, cotações, referências de pagamento); as consultas "em lote" que os repositórios não têm ficam aqui.
 */

const { avulso, iso, lerJson, dataBr } = require('../dados/executor');
const avisosRepo = require('../dados/avisos.repo');
const cotacoesRepo = require('../dados/cotacoes.repo');
const eventosRepo = require('../dados/eventos.repo');

const marcas = (n) => Array.from({ length: n }, () => '?').join(', ');
const unicos = (l) => [...new Set((l || []).map(String))];

/** TODOS os vínculos (ativos ou não) das conversas e das clientes: o contrato exige 1:1, então o conflito precisa ir junto. */
async function vinculos({ conversationIds, clientIds }) {
  const conversas = unicos(conversationIds);
  const clientes = unicos(clientIds);
  if (!conversas.length && !clientes.length) return [];
  const partes = []; const valores = [];
  if (conversas.length) { partes.push(`umbler_conversation_id IN (${marcas(conversas.length)})`); valores.push(...conversas); }
  if (clientes.length) { partes.push(`id_cliente IN (${marcas(clientes.length)})`); valores.push(...clientes); }
  const [linhas] = await avulso.execute(
    `SELECT id, id_cliente, umbler_contact_id, umbler_conversation_id, verified, active, attribution, first_contact, atualizado_em FROM gf_lilly_vinculos WHERE ${partes.join(' OR ')} ORDER BY atualizado_em DESC, id`, valores,
  );
  return linhas.map((l) => ({
    clientId: l.id_cliente, contactId: l.umbler_contact_id, conversationId: l.umbler_conversation_id, verified: l.verified === true, active: l.active === true,
    attribution: lerJson(l.attribution), firstContact: l.first_contact === true, atualizadoEm: iso(l.atualizado_em),
  }));
}

/** Eventos resolvidos das conversas desde `desdeIso`, mais antigos primeiro; até `limite + 1`. */
async function eventos({ conversationIds, desdeIso, limite }) {
  const conversas = unicos(conversationIds);
  if (!conversas.length) return [];
  const [linhas] = await avulso.execute(
    `SELECT id, source, at, conversation_id, message_id, actor, internal, id_cliente, tarologist_id, text, data FROM gf_lilly_eventos
     WHERE conversation_id IN (${marcas(conversas.length)}) AND at >= ? ORDER BY at, id LIMIT ${Number(limite) + 1}`, [...conversas, desdeIso],
  );
  return linhas.map((l) => ({
    id: l.id, source: l.source, at: iso(l.at), conversationId: l.conversation_id, messageId: l.message_id, actor: l.actor, internal: l.internal === true,
    clientId: l.id_cliente, tarologistId: l.tarologist_id, text: l.text || '', data: lerJson(l.data) || {},
  }));
}

/** Notas do horário do dia operacional (SEM o texto livre: o contrato proíbe copiá-lo). */
async function notasDoDia({ date, limite }) {
  const [linhas] = await avulso.execute(
    `SELECT id, tarologist_id, data_operacional, schedule_id, expected_at, ends_at, status, at FROM gf_lilly_notas_horario WHERE data_operacional = ? ORDER BY at, id LIMIT ${Number(limite) + 1}`, [date],
  );
  return linhas.map((l) => ({
    id: l.id, tarologistId: l.tarologist_id, date: dataBr(l.data_operacional), scheduleId: l.schedule_id, expectedAt: iso(l.expected_at), endsAt: iso(l.ends_at), status: l.status, at: iso(l.at),
  }));
}

/** Referências do provedor dos pagamentos pedidos (por `payment_id`). */
async function refsDePagamentos(paymentIds) {
  const ids = unicos(paymentIds);
  if (!ids.length) return [];
  const [linhas] = await avulso.execute(
    `SELECT payment_id, reference, mp_payment_id, external_transaction_id, end_to_end_id, source_event_id, provider_confirmed, authorized_by FROM gf_lilly_pagamento_refs WHERE payment_id IN (${marcas(ids.length)})`, ids,
  );
  return linhas.map((l) => ({
    paymentId: l.payment_id, reference: l.reference, mpPaymentId: l.mp_payment_id, externalTransactionId: l.external_transaction_id, endToEndId: l.end_to_end_id, sourceEventId: l.source_event_id, providerConfirmed: l.provider_confirmed === true, authorizedBy: l.authorized_by || undefined,
  }));
}

const avisosDaConversa = (conversationId) => avisosRepo.listarPorConversa(avulso, conversationId);
const cotacoesDaConversa = (conversationId) => cotacoesRepo.listarPorConversa(avulso, conversationId);
const eventoPorId = (id) => eventosRepo.buscarEvento(avulso, id);
const pagamentosPorReferencias = async (referencias) => (await require('../dados/pagamento-refs.repo').buscarPorReferencias(avulso, referencias)).map((r) => r.paymentId);

module.exports = { vinculos, eventos, notasDoDia, refsDePagamentos, avisosDaConversa, cotacoesDaConversa, eventoPorId, pagamentosPorReferencias };
