'use strict';

/**
 * `revision` do snapshot (Lilly v710, docs/banco/22 §3). INTEIRO (a reserva só aceita inteiro) derivado do estado operacional do dia: id, versão e
 * situação dos agendamentos abertos ou do dia e das consultas abertas ou do dia. Igualdade, não ordem: qualquer mudança nesse conjunto muda o número;
 * não é um contador crescente. O executor recalcula o MESMO número e recusa (409) se não conferir. Dois pontos da API sempre chegam ao mesmo valor
 * porque não dependem do escopo do evento.
 */

const { createHash } = require('crypto');
const leituras = require('../dados/leituras.v710');
const { hojeOperacional } = require('../../../_comum/dia-operacional');

const PRIMEIROS_HEX = 12; // 48 bits: cabe num inteiro seguro

function numeroDaRevisao(estado) {
  const linhas = [
    ...estado.agenda.map((l) => ['a', l.id, Number(l.version), l.agenda_outcome || '']),
    ...estado.consultas.map((l) => ['c', l.id, Number(l.version), l.status]),
  ];
  return parseInt(createHash('sha256').update(JSON.stringify(linhas), 'utf8').digest('hex').slice(0, PRIMEIROS_HEX), 16);
}

/** @param {Date} [agora] */
async function revisaoAtual(agora = new Date()) {
  const hoje = hojeOperacional(agora);
  const inicioDiaIso = new Date(`${hoje}T06:00:00-03:00`).toISOString();
  return numeroDaRevisao(await leituras.estadoDaRevisao({ hoje, inicioDiaIso }));
}

module.exports = { revisaoAtual, numeroDaRevisao };
