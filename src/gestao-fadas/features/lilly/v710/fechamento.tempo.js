'use strict';

/**
 * Tempo do fechamento da consulta (Lilly v710): porte de `closingTiming` (server/lilly/consultation-closing.mjs) sobre a consulta no vocabulário da Lilly
 * (a mesma linha do snapshot). A aritmética de pausas é a do domínio (`consulta-comum`: `segundosPausadosEntre`, `fimComPausas`; ouro contra
 * `consultation-pause-timing.mjs`). Minutos comprados NUNCA são relógio de consulta. Puro.
 */

const { createHash } = require('crypto');
const { segundosPausadosEntre, fimComPausas } = require('../../../_comum/dominio/consulta-comum');

const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const chave = (v) => (v == null ? '' : String(v));
const dobrar = (v) => chave(v).trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const EM_CURSO = ['open', 'active', 'in_progress', 'em curso', 'finalizada pelo tarologo'];
const FECHADA = ['closed', 'completed', 'concluida', 'ended'];
const OCUPANDO = ['prepared', 'ready', 'pending_start', 'forwarded'];

const ativa = (c) => EM_CURSO.includes(dobrar(c && c.status));
const fechada = (c) => FECHADA.includes(dobrar(c && c.status));
const ocupando = (c) => ativa(c) || OCUPANDO.includes(dobrar(c && c.status));

/** @returns {null | {startedAt:string,endedAt:string,durationSeconds:number,minutes:number,billableMinutes:number,source:string,pauseFingerprint:string}} */
function tempoDoFechamento(row, evento) {
  const startedAt = row.tarologistStartedAt || row.startedAt;
  const inicio = Date.parse(startedAt); const ate = Date.parse(evento.at);
  if (!ativa(row) || row.awaitingTarologistStart || !Number.isFinite(inicio) || !Number.isFinite(ate) || ate <= inicio) return null;
  const decorrido = (ate - inicio) / 1000 - segundosPausadosEntre(row, inicio, ate);
  const dado = evento.data || {};
  const relato = Number.isFinite(dado.minutes) && dado.minutes > 0 ? dado.minutes
    : row.tarologistFinishReport && Number.isFinite(row.tarologistFinishReport.minutes) && row.tarologistFinishReport.minutes > 0 ? row.tarologistFinishReport.minutes : null;
  const segundos = relato !== null ? Math.round(relato * 60) : Math.floor(decorrido);
  if (segundos <= 0 || segundos > decorrido + 1) return null;
  const minutos = segundos / 60;
  return {
    startedAt, endedAt: fimComPausas(row, segundos, evento.at, startedAt), durationSeconds: segundos, minutes: minutos, billableMinutes: Math.ceil(minutos),
    source: relato !== null ? 'reported' : 'registered_clock', pauseFingerprint: sha(row.pauseHistory || []),
  };
}

module.exports = { tempoDoFechamento, ativa, fechada, ocupando, sha, chave, dobrar };
