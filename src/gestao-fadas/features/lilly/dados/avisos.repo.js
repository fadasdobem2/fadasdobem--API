'use strict';

/** `gf_lilly_avisos`: avisos (notices) enviados à cliente. Idempotente por `id`. */

const { iso } = require('./executor');

const COLUNAS = 'id, conversation_id, id_cliente, appointment_id, message_id, sent_at, autor';

const paraObjeto = (l) => l && ({
  id: l.id,
  conversationId: l.conversation_id,
  clientId: l.id_cliente,
  appointmentId: l.appointment_id,
  messageId: l.message_id,
  sentAt: iso(l.sent_at),
  autor: l.autor,
});

async function gravarAviso(executor, a) {
  await executor.execute(
    'INSERT IGNORE INTO gf_lilly_avisos (id, conversation_id, id_cliente, appointment_id, message_id, sent_at, autor) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [a.id, a.conversationId, a.clientId ?? null, a.appointmentId ?? null, a.messageId ?? null, a.sentAt, a.autor ?? null],
  );
  const [linhas] = await executor.execute(`SELECT ${COLUNAS} FROM gf_lilly_avisos WHERE id = ?`, [a.id]);
  return paraObjeto(linhas[0]) || null;
}

async function listarPorConversa(executor, conversationId) {
  const [linhas] = await executor.execute(`SELECT ${COLUNAS} FROM gf_lilly_avisos WHERE conversation_id = ? ORDER BY sent_at, id`, [conversationId]);
  return linhas.map(paraObjeto);
}

async function listarPorAgendamento(executor, appointmentId) {
  const [linhas] = await executor.execute(`SELECT ${COLUNAS} FROM gf_lilly_avisos WHERE appointment_id = ? ORDER BY sent_at, id`, [appointmentId]);
  return linhas.map(paraObjeto);
}

module.exports = { gravarAviso, listarPorConversa, listarPorAgendamento };
