'use strict';

/** Formas de resposta da Agenda: leitura (`items`) e gravação (`agenda`), sempre com versões e revisões `queue-v1` das filas tocadas. */

const { hojeOperacional } = require('../../_comum/dia-operacional');
const { revisaoDaFila } = require('../../_comum/dominio/agenda-ordem');

const versoes = (registros) => Object.fromEntries(registros.map((r) => [r.item.id, r.version]));

/** Revisão de cada fila (tarólogo) dos `abertos` pedidos. */
function revisoes(abertos, tarotIds) {
  return Object.fromEntries([...new Set(tarotIds)].map((t) => [t, revisaoDaFila(abertos, t)]));
}

function leitura(registros, hoje = hojeOperacional(), { intakeEvents = [], requests = [] } = {}) {
  const itens = registros.map((r) => r.item);
  return {
    readAt: new Date().toISOString(), today: hoje, items: itens, versions: versoes(registros),
    queueRevisions: revisoes(itens, itens.map((i) => i.tarotId)), intakeEvents, requests,
  };
}

/** `registros`: os agendamentos que mudaram; `abertos`: itens abertos das filas tocadas (para a revisão). */
function gravacao(registros, abertos, tarotIds) {
  return { readAt: new Date().toISOString(), today: hojeOperacional(), agenda: registros.map((r) => r.item), versions: versoes(registros), queueRevisions: revisoes(abertos, tarotIds) };
}

module.exports = { leitura, gravacao, versoes, revisoes };
