'use strict';

/**
 * Leituras do banco novo para a Lilly v710 (revisão, assinatura das linhas e fila). SEMPRE pelos models de leitura (`novo/leitura.js`), no contexto E
 * na execução: a assinatura que a Lilly compara (`expectedAppointment`, `expectedConsultation`) é calculada sobre a MESMA linha lida do mesmo jeito,
 * senão tipos de data (Date x texto) mudariam o resultado. A trava de concorrência é a `expectedVersion` do serviço que grava.
 */

const { Op } = require('sequelize');
const { lendoNovo } = require('../../../novo/leitura');

const unicos = (l) => [...new Set((l || []).map(String))];

/** Um agendamento (linha do model) ou `null`. */
const agendamentoPorId = (id) => lendoNovo((m) => m.GfAgenda.findOne({ where: { id: String(id) } }));

/** Uma consulta (linha do model) ou `null`. */
const consultaPorId = (id) => lendoNovo((m) => m.GfConsultasExt.findOne({ where: { id: String(id) } }));

/** Agendamentos ABERTOS de um tarólogo (a fila inteira, de qualquer data). */
const filaAbertaDe = (tarotId) => lendoNovo((m) => m.GfAgenda.findAll({ where: { id_tarologo: String(tarotId), agenda_outcome: null }, order: [['numero_publico', 'ASC']] }));

/** Consultas abertas (`Em curso`, `Finalizada pelo tarólogo`) de um tarólogo ou de uma cliente, para a ocupação e o desvio de fila. */
const consultasAbertas = ({ tarotId, clientId }) => lendoNovo((m) => m.GfConsultasExt.findAll({
  where: { status: { [Op.in]: ['Em curso', 'Finalizada pelo tarólogo'] }, [Op.or]: [...(tarotId ? [{ id_tarologo: String(tarotId) }] : []), ...(clientId ? [{ id_cliente: String(clientId) }] : [])] },
}));

/** Filhas diretas de uma consulta (continuações), qualquer status. */
const continuacoesDe = (consultaId) => lendoNovo((m) => m.GfConsultasExt.findAll({ where: { consulta_origem_id: String(consultaId) } }));

/** Consultas de uma cliente (cadeia da continuação e ocupação). */
const consultasDaCliente = (clientId) => lendoNovo((m) => m.GfConsultasExt.findAll({ where: { id_cliente: String(clientId) }, order: [['iniciada_em', 'ASC'], ['id', 'ASC']] }));

/**
 * Estado que define a revisão: (id, versão, situação) dos agendamentos abertos ou do dia operacional e das consultas abertas ou do dia. Não depende
 * do escopo do evento: o contexto e a execução enxergam o mesmo conjunto.
 */
async function estadoDaRevisao({ hoje, inicioDiaIso }) {
  return lendoNovo(async (m) => {
    const agenda = await m.GfAgenda.findAll({ attributes: ['id', 'version', 'agenda_outcome'], where: { [Op.or]: [{ agenda_outcome: null }, { data_operacional: { [Op.gte]: hoje } }] }, order: [['id', 'ASC']], raw: true });
    const consultas = await m.GfConsultasExt.findAll({
      attributes: ['id', 'version', 'status'],
      where: { [Op.or]: [{ status: { [Op.in]: ['Em curso', 'Finalizada pelo tarólogo'] } }, { iniciada_em: { [Op.gte]: inicioDiaIso } }, { encerrada_em: { [Op.gte]: inicioDiaIso } }] },
      order: [['id', 'ASC']], raw: true,
    });
    return { agenda, consultas };
  });
}

module.exports = { agendamentoPorId, consultaPorId, filaAbertaDe, consultasAbertas, continuacoesDe, consultasDaCliente, estadoDaRevisao, unicos };
