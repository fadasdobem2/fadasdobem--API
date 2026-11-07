'use strict';

/** `gf_lilly_notas_horario`: notas do horário do tarólogo (waiting/arrived/resolved). */

const { iso, dataBr } = require('./executor');

const COLUNAS = 'id, tarologist_id, data_operacional, schedule_id, expected_at, ends_at, status, texto, conversation_id, message_id, at, criado_em';

const paraObjeto = (l) => ({
  id: l.id,
  tarologistId: l.tarologist_id,
  date: dataBr(l.data_operacional),
  scheduleId: l.schedule_id,
  expectedAt: iso(l.expected_at),
  endsAt: iso(l.ends_at),
  status: l.status,
  text: l.texto,
  conversationId: l.conversation_id,
  messageId: l.message_id,
  at: iso(l.at),
});

/** Idempotente por `id`: a primeira gravação vence. Devolve `{ nota, repetida }`. */
async function gravarNota(executor, n) {
  const [r] = await executor.execute(
    `INSERT IGNORE INTO gf_lilly_notas_horario (id, tarologist_id, data_operacional, schedule_id, expected_at, ends_at, status, texto, conversation_id, message_id, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [n.id, n.tarologistId, n.date, n.scheduleId ?? null, n.expectedAt ?? null, n.endsAt ?? null, n.status, n.text, n.conversationId ?? null, n.messageId ?? null, n.at],
  );
  const [linhas] = await executor.execute(`SELECT ${COLUNAS} FROM gf_lilly_notas_horario WHERE id = ?`, [n.id]);
  return { nota: paraObjeto(linhas[0]), repetida: r.affectedRows === 0 };
}

async function listarNotas(executor, { tarologistId, date }) {
  const [linhas] = await executor.execute(
    `SELECT ${COLUNAS} FROM gf_lilly_notas_horario WHERE tarologist_id = ? AND data_operacional = ? ORDER BY at, id`, [tarologistId, date],
  );
  return linhas.map(paraObjeto);
}

module.exports = { gravarNota, listarNotas };
