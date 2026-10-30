'use strict';

/**
 * Validação das entradas da Presença. As mensagens de regra (422 RULE_VIOLATION) são as do front
 * (`tarologas/staff-presence-model.ts`, `presence-return-forecast.ts`). Nada do que o cliente manda escolhe perfil, conta, ator,
 * horário do servidor, histórico nem o carimbo de confirmação: só a declaração de turno (D9).
 */

const AppError = require('../../../utils/AppError');
const { MOTIVOS_PAUSA } = require('../../_comum/dominio/presenca');

const TURNOS = Object.freeze(['Disponível', 'Em pausa', 'Offline']);
const SAIDAS = Object.freeze(['ended', 'return', 'missing', 'shift-ended']);
const PREVISOES = Object.freeze(['next-shift', 'afternoon', 'evening', 'approximate', 'exact']);
const CONFIRMACOES = Object.freeze(['none', 'keep', 'manual']);

const invalido = (campo) => new AppError('Dados inválidos.', 400, { codigo: 'INVALID_INPUT', campo }, true);
const regra = (mensagem) => new AppError(mensagem, 422, { codigo: 'RULE_VIOLATION' }, true);
const ehObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const ehData = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
const ehHora = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function chaveOperacao(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(v)) throw invalido('operationKey');
  return v;
}
function idTarologo(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(v)) throw invalido('tarotId');
  return v;
}
/** Revisão: inteiro em texto ("0" = ainda sem estado). */
function revisao(v) {
  if (typeof v !== 'string' || !/^\d{1,9}$/.test(v)) throw invalido('expectedRevision');
  return v;
}
function instante(v, campo) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) || !Number.isFinite(Date.parse(v))) throw invalido(campo);
  return new Date(v).toISOString();
}

function previsao(p) {
  if (!ehObjeto(p) || !PREVISOES.includes(p.kind)) throw invalido('returnForecast');
  const saida = { kind: p.kind };
  for (const campo of ['date', 'scheduleDate', 'endDate']) {
    if (p[campo] === undefined) continue;
    if (!ehData(p[campo])) throw invalido(`returnForecast.${campo}`);
    saida[campo] = p[campo];
  }
  for (const campo of ['time', 'endTime']) {
    if (p[campo] === undefined) continue;
    if (!ehHora(p[campo])) throw invalido(`returnForecast.${campo}`);
    saida[campo] = p[campo];
  }
  return saida;
}

/** Corpo de `POST /presence/:tarotId/status`: a declaração de turno do tarólogo. */
function corpoStatus(corpo) {
  if (!ehObjeto(corpo) || !TURNOS.includes(corpo.shiftStatus)) throw invalido('shiftStatus');
  const c = { operationKey: chaveOperacao(corpo.operationKey), expectedRevision: revisao(corpo.expectedRevision), shiftStatus: corpo.shiftStatus, confirmation: 'none' };
  if (corpo.confirmation !== undefined) { if (!CONFIRMACOES.includes(corpo.confirmation)) throw invalido('confirmation'); c.confirmation = corpo.confirmation; }
  if (corpo.shiftExit !== undefined) {
    if (!SAIDAS.includes(corpo.shiftExit) || corpo.shiftStatus !== 'Offline') throw invalido('shiftExit');
    c.shiftExit = corpo.shiftExit;
  }
  if (corpo.pauseReason !== undefined) {
    if (!MOTIVOS_PAUSA.includes(corpo.pauseReason) || corpo.shiftStatus !== 'Em pausa') throw invalido('pauseReason');
    c.pauseReason = corpo.pauseReason;
  }
  if (corpo.expectedReturn !== undefined) {
    if (corpo.shiftStatus === 'Disponível') throw invalido('expectedReturn');
    c.expectedReturn = instante(corpo.expectedReturn, 'expectedReturn');
  }
  if (corpo.returnUntil !== undefined) {
    if (corpo.shiftStatus !== 'Offline' || c.shiftExit !== 'return') throw invalido('returnUntil');
    c.returnUntil = instante(corpo.returnUntil, 'returnUntil');
    if (c.expectedReturn && Date.parse(c.returnUntil) <= Date.parse(c.expectedReturn)) throw regra('O término deve ser depois do retorno, no mesmo dia de atendimento.');
  }
  if (corpo.returnForecast !== undefined) {
    if (c.shiftExit !== 'return') throw invalido('returnForecast');
    c.returnForecast = previsao(corpo.returnForecast);
  }
  return c;
}

/** Corpo de `POST /presence/:tarotId/confirm`. */
const corpoConfirmar = (corpo) => ({ operationKey: chaveOperacao(ehObjeto(corpo) ? corpo.operationKey : undefined), expectedRevision: revisao(ehObjeto(corpo) ? corpo.expectedRevision : undefined) });
/** Corpo de `POST /presence/:tarotId/request`. */
const corpoPedido = (corpo) => ({ operationKey: chaveOperacao(ehObjeto(corpo) ? corpo.operationKey : undefined) });

module.exports = { TURNOS, SAIDAS, PREVISOES, CONFIRMACOES, idTarologo, chaveOperacao, corpoStatus, corpoConfirmar, corpoPedido };
