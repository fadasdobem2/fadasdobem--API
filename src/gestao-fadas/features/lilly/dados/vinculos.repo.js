'use strict';

/** `gf_lilly_vinculos`: cliente x contato Umbler x conversa. Único por (contato, conversa). */

const { randomUUID } = require('crypto');
const { lerJson, gravarJson, iso } = require('./executor');

const COLUNAS = 'id, id_cliente, umbler_contact_id, umbler_conversation_id, verified, active, attribution, first_contact, criado_em, atualizado_em';

const paraObjeto = (l) => l && ({
  id: l.id,
  clientId: l.id_cliente,
  contactId: l.umbler_contact_id,
  conversationId: l.umbler_conversation_id,
  verified: l.verified === true,
  active: l.active === true,
  attribution: lerJson(l.attribution),
  firstContact: l.first_contact === true,
  criadoEm: iso(l.criado_em),
  atualizadoEm: iso(l.atualizado_em),
});

/** Cria o vínculo ou atualiza o existente (mesmo contato+conversa). Devolve o vínculo gravado. */
async function salvarVinculo(executor, { clientId, contactId, conversationId, verified = false, active = true, attribution = null, firstContact = false }) {
  await executor.execute(
    `INSERT IGNORE INTO gf_lilly_vinculos (id, id_cliente, umbler_contact_id, umbler_conversation_id, verified, active, attribution, first_contact)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), clientId, contactId, conversationId, verified, active, gravarJson(attribution), firstContact],
  );
  await executor.execute(
    `UPDATE gf_lilly_vinculos SET id_cliente = ?, verified = ?, active = ?, attribution = ?, first_contact = ?, atualizado_em = CURRENT_TIMESTAMP
     WHERE umbler_contact_id = ? AND umbler_conversation_id = ?`,
    [clientId, verified, active, gravarJson(attribution), firstContact, contactId, conversationId],
  );
  return buscarPorContatoConversa(executor, contactId, conversationId);
}

async function buscarPorContatoConversa(executor, contactId, conversationId) {
  const [linhas] = await executor.execute(
    `SELECT ${COLUNAS} FROM gf_lilly_vinculos WHERE umbler_contact_id = ? AND umbler_conversation_id = ?`, [contactId, conversationId],
  );
  return paraObjeto(linhas[0]) || null;
}

/** O vínculo vigente (ativo e verificado) da conversa, ou `null`. É daqui que o evento tira o `clientId`. */
async function buscarAtivoDaConversa(executor, conversationId) {
  const [linhas] = await executor.execute(
    `SELECT ${COLUNAS} FROM gf_lilly_vinculos WHERE umbler_conversation_id = ? AND active = TRUE AND verified = TRUE ORDER BY atualizado_em DESC, id`, [conversationId],
  );
  return paraObjeto(linhas[0]) || null;
}

async function listarPorCliente(executor, clientId) {
  const [linhas] = await executor.execute(`SELECT ${COLUNAS} FROM gf_lilly_vinculos WHERE id_cliente = ? ORDER BY atualizado_em DESC, id`, [clientId]);
  return linhas.map(paraObjeto);
}

/** Desativa os vínculos do cliente com outras conversas/contatos que não o informado (um vínculo atual por cliente). */
async function desativarOutros(executor, clientId, contactId, conversationId) {
  await executor.execute(
    `UPDATE gf_lilly_vinculos SET active = FALSE, atualizado_em = CURRENT_TIMESTAMP
     WHERE id_cliente = ? AND active = TRUE AND NOT (umbler_contact_id = ? AND umbler_conversation_id = ?)`,
    [clientId, contactId, conversationId],
  );
}

module.exports = { salvarVinculo, buscarPorContatoConversa, buscarAtivoDaConversa, listarPorCliente, desativarOutros };
