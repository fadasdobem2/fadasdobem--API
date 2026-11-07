'use strict';

/**
 * Posição NATURAL do agendamento na fila (Maturacao/60, item 7): o lugar real depois de inserido, pelo mesmo comparador do painel
 * (`compararFila`), entre os abertos do mesmo tarólogo e do mesmo dia. Nunca devolve o `position` cru do banco se der para calcular.
 * Lê com o executor da transação (o agendamento já foi confirmado pelo serviço da agenda).
 */

const store = require('../../agenda/agenda.store');
const { compararFila } = require('../../../_comum/dominio/painel-ordem');
const { encerrado } = require('../../../_comum/dominio/agenda-contato');

async function posicaoNatural(executor, { id, tarotId, hoje, agora = Date.now() }) {
  const abertos = await store.abertosDe(executor, [tarotId]);
  const alvo = abertos.find((i) => i.id === id);
  if (!alvo) return null;
  const dia = alvo.date || hoje;
  const fila = abertos.filter((i) => !encerrado(i) && i.workflowStatus !== 'Em consulta' && (i.date || hoje) === dia);
  try {
    const ordenada = [...fila].sort((a, b) => compararFila(a, b, agora, hoje, false));
    const indice = ordenada.findIndex((i) => i.id === id);
    return indice >= 0 ? indice + 1 : alvo.position;
  } catch (_e) {
    return alvo.position;
  }
}

module.exports = { posicaoNatural };
