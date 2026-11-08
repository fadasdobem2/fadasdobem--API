'use strict';

/**
 * Fila do tarólogo para a correção de posição (Lilly v710, `appointmentPositionQuotes` e `reorder_appointment`). A ordem é a do comparador do painel
 * (`painel-ordem.js#compararFila`, porte de `compareAgendaQueue`, FILA INTEIRA do destino, de qualquer data, como `schedulePositionModel`); a revisão da
 * fila é a `queue-v1` do comando de ordem (`agenda-ordem.js#revisaoDaFila`), a mesma que o `POST /agenda/queues/:tarotId/order` confere. Puro.
 * LIMITE: o front também considera prontidão por pagamento e reservas de continuação (`createAgendaQueueLookup`); aqui só o comparador portado.
 */

const { createHash } = require('crypto');
const { encerrado } = require('../../../_comum/dominio/agenda-contato');
const { compararFila, reordenar } = require('../../../_comum/dominio/painel-ordem');
const q = require('../../../_comum/dominio/painel-fila-geral');
const { revisaoDaFila } = require('../../../_comum/dominio/agenda-ordem');

const itemDaLinha = (l) => ({ ...(typeof l.item === 'string' ? JSON.parse(l.item) : l.item), id: l.id });
const emConsulta = (consultas, id) => consultas.some((c) => (c.id_agenda || c.agendaItemId) === id && c.status === 'Em curso' && !(c.item && (c.item.tarologistFinishReport)));

/** Itens abertos (domínio) a partir das linhas do model. */
const itensAbertos = (linhas) => linhas.map(itemDaLinha).filter((i) => !encerrado(i));

/** Ids na ordem vigente: abertos, fora de "Em consulta" e sem consulta em curso ligada. */
function ordemVigente(itens, consultas, { agora, hoje }) {
  const fila = itens.filter((i) => !encerrado(i) && i.workflowStatus !== 'Em consulta' && !emConsulta(consultas, i.id));
  return fila.sort((a, b) => compararFila(a, b, agora, hoje, true)).map((i) => i.id);
}

const revisaoDaFilaDe = (itens, tarotId) => revisaoDaFila(itens, tarotId);
const escopoDoDia = (hoje) => q.escopoDaData(hoje);

/** Posições novas do alvo: devolve os `ranks` que mudaram (só as chaves alteradas) para o comando de ordem. */
function ranksDaMudanca(itens, idsNovos, escopo) {
  const depois = reordenar(itens, idsNovos, escopo, true);
  const ranks = {};
  for (const novo of depois) {
    const antigo = itens.find((i) => i.id === novo.id);
    const a = (antigo && antigo.positionOverrides) || {}; const n = novo.positionOverrides || {};
    const mudou = Object.fromEntries(Object.entries(n).filter(([k, v]) => a[k] !== v));
    if (Object.keys(mudou).length) ranks[novo.id] = mudou;
  }
  return ranks;
}

const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

module.exports = { itemDaLinha, itensAbertos, ordemVigente, revisaoDaFilaDe, ranksDaMudanca, escopoDoDia, emConsulta, sha };
