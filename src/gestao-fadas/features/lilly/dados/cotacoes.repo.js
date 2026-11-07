'use strict';

/** `gf_lilly_cotacoes`: cotação por conversa. Só uma é a atual (`current`). */

const { iso } = require('./executor');

const COLUNAS = 'id, conversation_id, id_cliente, current, created_at, amount_centavos, minutes';

const paraObjeto = (l) => l && ({
  id: l.id,
  conversationId: l.conversation_id,
  clientId: l.id_cliente,
  current: l.current === true,
  createdAt: iso(l.created_at),
  amountCentavos: Number(l.amount_centavos),
  minutes: l.minutes,
});

/** Grava a cotação (idempotente por `id`). Se for a atual, as anteriores da conversa deixam de ser. */
async function gravarCotacao(executor, c) {
  const atual = c.current !== false;
  if (atual) {
    await executor.execute('UPDATE gf_lilly_cotacoes SET current = FALSE WHERE conversation_id = ? AND current = TRUE AND id <> ?', [c.conversationId, c.id]);
  }
  await executor.execute(
    'INSERT IGNORE INTO gf_lilly_cotacoes (id, conversation_id, id_cliente, current, created_at, amount_centavos, minutes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [c.id, c.conversationId, c.clientId ?? null, atual, c.createdAt, c.amountCentavos, c.minutes],
  );
  return buscarCotacao(executor, c.id);
}

async function buscarCotacao(executor, id) {
  const [linhas] = await executor.execute(`SELECT ${COLUNAS} FROM gf_lilly_cotacoes WHERE id = ?`, [id]);
  return paraObjeto(linhas[0]) || null;
}

async function listarPorConversa(executor, conversationId) {
  const [linhas] = await executor.execute(`SELECT ${COLUNAS} FROM gf_lilly_cotacoes WHERE conversation_id = ? ORDER BY created_at, id`, [conversationId]);
  return linhas.map(paraObjeto);
}

module.exports = { gravarCotacao, buscarCotacao, listarPorConversa };
