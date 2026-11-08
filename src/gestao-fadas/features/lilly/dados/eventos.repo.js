'use strict';

/** `gf_lilly_eventos`: eventos já RESOLVIDOS e verificados (a "prova"). Só acrescenta (gatilho no banco). Idempotente por `id`. */

const { lerJson, gravarJson, iso } = require('./executor');

const COLUNAS = 'id, source, at, conversation_id, contact_id, message_id, actor, internal, id_cliente, tarologist_id, text, data, provider_meta, staff_authorized, staff_id, recebido_em';

/** Linha -> evento normalizado do contrato (seção 4.1). */
const paraEvento = (l) => l && ({
  id: l.id,
  at: iso(l.at),
  type: 'message',
  source: l.source,
  conversationId: l.conversation_id,
  contactId: l.contact_id,
  messageId: l.message_id,
  actor: l.actor,
  internal: l.internal === true,
  clientId: l.id_cliente,
  tarologistId: l.tarologist_id,
  text: l.text,
  data: lerJson(l.data) || {},
  ...(l.provider_meta ? { providerMeta: lerJson(l.provider_meta) } : {}),
});

async function buscarEvento(executor, id) {
  const [linhas] = await executor.execute(`SELECT ${COLUNAS} FROM gf_lilly_eventos WHERE id = ?`, [id]);
  return linhas[0] ? paraEvento(linhas[0]) : null;
}

/** Grava o evento se ainda não existe. Devolve `{ evento, repetido }` com o evento GUARDADO (o primeiro vence). */
async function gravarEvento(executor, e) {
  const [r] = await executor.execute(
    `INSERT IGNORE INTO gf_lilly_eventos (id, source, at, conversation_id, contact_id, message_id, actor, internal, id_cliente, tarologist_id, text, data, provider_meta, staff_authorized, staff_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.id, e.source, e.at, e.conversationId ?? null, e.contactId ?? null, e.messageId ?? null, e.actor, e.internal === true, e.clientId ?? null,
      e.tarologistId ?? null, e.text ?? null, gravarJson(e.data || {}), gravarJson(e.providerMeta), e.data?.staffAuthorized === true, e.data?.staffId ?? null,
    ],
  );
  return { evento: await buscarEvento(executor, e.id), repetido: r.affectedRows === 0 };
}

/**
 * Prova da autorização humana (D10): o evento existe, é da conversa (e do cliente, se informado) e foi resolvido com
 * `staffAuthorized:true`. Devolve o evento ou `null`.
 */
async function buscarEventoAutorizado(executor, id, { conversationId, clientId } = {}) {
  const [linhas] = await executor.execute(
    `SELECT ${COLUNAS} FROM gf_lilly_eventos WHERE id = ? AND staff_authorized = TRUE AND internal = TRUE`, [id],
  );
  const e = linhas[0] ? paraEvento(linhas[0]) : null;
  if (!e) return null;
  if (conversationId && e.conversationId !== conversationId) return null;
  if (clientId && e.clientId !== `${clientId}`) return null;
  return e;
}

/** Evento de origem de uma ação v710 pelo `id` OU pelo `messageId` (a Lilly cita `e.messageId||e.id`). `null` se não há ou se é ambíguo. */
async function buscarEventoDeOrigem(executor, ref) {
  const [linhas] = await executor.execute(`SELECT ${COLUNAS} FROM gf_lilly_eventos WHERE id = ? OR message_id = ? ORDER BY at DESC LIMIT 2`, [ref, ref]);
  return linhas.length === 1 || (linhas.length === 2 && linhas[0].id === ref) ? paraEvento(linhas[0]) : null;
}

async function listarPorConversa(executor, conversationId, limite = 200) {
  const [linhas] = await executor.execute(
    `SELECT ${COLUNAS} FROM gf_lilly_eventos WHERE conversation_id = ? ORDER BY at, id LIMIT ${Math.min(Math.max(Number(limite) | 0, 1), 1000)}`, [conversationId],
  );
  return linhas.map(paraEvento);
}

module.exports = { buscarEvento, gravarEvento, buscarEventoAutorizado, buscarEventoDeOrigem, listarPorConversa };
