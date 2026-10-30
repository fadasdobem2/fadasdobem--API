'use strict';

/**
 * A agenda que nasce da consulta (pendência (c)): aplica `consulta-agenda.js` ao agendamento vinculado (`agendaItemId`) na MESMA
 * transação da consulta, com versão nova e evento de resolução em `gf_agenda_eventos`. Só o vínculo explícito; sem agendamento,
 * já encerrado ou de outra cliente, nada muda. Usa o store da Agenda (nada de SQL novo).
 */

const agendaStore = require('../agenda/agenda.store');
const { resolverAgenda, concluirAgenda } = require('../../_comum/dominio/consulta-agenda');

/** `modo`: 'iniciou' (retira da fila, "Em consulta") ou 'terminou' (vira "Concluída"). Devolve os registros da agenda que mudaram. */
async function resolver(ex, consulta, modo, a, operationKey) {
  if (!consulta.agendaItemId) return [];
  const reg = await agendaStore.travar(ex, consulta.agendaItemId);
  if (!reg) return [];
  const em = new Date().toISOString();
  const proximo = modo === 'iniciou' ? resolverAgenda(reg.item, consulta, a.nome, em, false) : concluirAgenda(reg.item, consulta, em);
  if (proximo === reg.item) return [];
  const versao = reg.version + 1;
  await agendaStore.atualizar(ex, proximo, versao);
  const evento = (proximo.resolutionHistory || [])[(proximo.resolutionHistory || []).length - 1];
  const ref = modo === 'iniciou' ? (evento && evento.id) : `agenda-resolution-finish-${proximo.id}-${consulta.id}`;
  await agendaStore.inserirEvento(ex, { idAgenda: proximo.id, tipo: 'resolucao', ref, a, dados: { consultationId: consulta.id, modo }, versao, operationKey });
  return [{ item: proximo, version: versao }];
}

module.exports = { resolver };
