'use strict';

/**
 * `appointmentPositionQuotes` (Lilly v710, docs/banco/22 §4): para cada agendamento ABERTO das clientes em foco, a ordem vigente da fila do tarólogo
 * (`orderedAppointmentIds`, ids únicos) e a revisão da fila (`queue-v1`, a que o comando de ordem confere). Uma cotação por agendamento. Fila geral
 * (`afila`) e agendamento em consulta ficam sem cotação (a Lilly pede conferência). Sem dado verificável a cotação NÃO sai.
 */

const fila = require('../v710/fila');
const { ordemDoTarologo } = require('../v710/ordem');

const CINCO_MIN_MS = 5 * 60 * 1000;

/** @param {{ linhas: object[] }} agenda  @param {{ agora: Date, hoje: string }} t  @returns {Promise<object[]>} */
async function montarCotacoesDePosicao(agenda, { agora, hoje, focoIds }, f = {}) {
  const abertas = agenda.linhas.filter((l) => !l.agenda_outcome && l.id_tarologo !== 'afila' && focoIds.includes(`${l.id_cliente}`));
  const tarologos = [...new Set(abertas.map((l) => l.id_tarologo))];
  const saida = [];
  for (const tarotId of tarologos) {
    const { ordem, revisao } = await ordemDoTarologo(tarotId, { agora: agora.getTime(), hoje }, f);
    for (const l of abertas.filter((x) => x.id_tarologo === tarotId)) {
      if (!ordem.includes(l.id) || new Set(ordem).size !== ordem.length) continue;
      saida.push({
        id: `pos-${fila.sha([l.id, revisao, ordem]).slice(0, 32)}`, current: true, appointmentId: l.id, clientId: l.id_cliente, tarologistId: tarotId, tarotId,
        revision: revisao, orderedAppointmentIds: ordem, expiresAt: new Date(agora.getTime() + CINCO_MIN_MS).toISOString(),
      });
    }
  }
  return saida;
}

module.exports = { montarCotacoesDePosicao };
