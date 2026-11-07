'use strict';

/**
 * Lugar do pedido de agendamento entre os cartões da Agenda (domínio puro), v706 da Nice. Porte de `features/agenda/request-queue-order.ts`.
 * O pedido guarda a própria identidade; a âncora (`beforeAgendaId`/`afterAgendaId`) só o posiciona entre agendamentos reais.
 * Reordenar não confirma agendamento, não cria consulta nem pagamento e não muda a etapa. Ouro: scripts/gerar-ouro-gf-agenda-pedido.js.
 */

/** @param blocos `[{ key, request? }]`: `agenda:<id>` para agendamentos, `request:<id>` para pedidos. */
function organizarFilaDePedidos(blocos) {
  const agenda = blocos.filter((b) => !b.request);
  const pedidos = blocos.filter((b) => b.request);
  const indice = new Map(agenda.map((b, i) => [b.key, i]));
  const balde = (b) => {
    const p = b.request.queuePlacement;
    if (!p) return agenda.length;
    if (p.beforeAgendaId && indice.has(`agenda:${p.beforeAgendaId}`)) return indice.get(`agenda:${p.beforeAgendaId}`);
    if (p.afterAgendaId && indice.has(`agenda:${p.afterAgendaId}`)) return indice.get(`agenda:${p.afterAgendaId}`) + 1;
    return agenda.length;
  };
  const ordem = (b) => (b.request.queuePlacement && b.request.queuePlacement.order) ?? Infinity;
  const ordenados = pedidos.map((bloco, i) => ({ bloco, i })).sort((a, b) => balde(a.bloco) - balde(b.bloco) || ordem(a.bloco) - ordem(b.bloco) || a.i - b.i);
  return Array.from({ length: agenda.length + 1 }, (_, i) => [...ordenados.filter(({ bloco }) => balde(bloco) === i).map(({ bloco }) => bloco), ...(agenda[i] ? [agenda[i]] : [])]).flat();
}

function moverBloco(chaves, origem, destino) {
  const de = chaves.indexOf(origem);
  const para = destino ? chaves.indexOf(destino) : chaves.length;
  if (de < 0 || para < 0 || origem === destino) return chaves;
  const resto = chaves.filter((k) => k !== origem);
  const em = destino ? resto.indexOf(destino) + (de < para ? 1 : 0) : resto.length;
  resto.splice(em, 0, origem);
  return resto;
}

function lugaresDosPedidos(chaves) {
  return Object.fromEntries(chaves.flatMap((chave, i) => (chave.startsWith('request:') ? [[chave.slice(8), {
    beforeAgendaId: (chaves.slice(i + 1).find((v) => v.startsWith('agenda:')) || '').slice(7) || undefined,
    afterAgendaId: ([...chaves.slice(0, i)].reverse().find((v) => v.startsWith('agenda:')) || '').slice(7) || undefined,
    order: i,
  }]] : [])));
}

/** Impressão da fila de pedidos: a revisão que o servidor compara antes de aceitar um novo lugar. */
function revisaoDosPedidos(pedidos) {
  return JSON.stringify(pedidos.map(({ id, tarotId, date, stage, agendaId, queuePlacement }) => ({ id, tarotId, date, stage, agendaId, queuePlacement })).sort((a, b) => a.id.localeCompare(b.id)));
}

module.exports = { organizarFilaDePedidos, moverBloco, lugaresDosPedidos, revisaoDosPedidos };
