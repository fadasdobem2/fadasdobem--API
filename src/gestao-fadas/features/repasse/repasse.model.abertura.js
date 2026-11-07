'use strict';

/** Leitura do DTO das aberturas (Saldo Migrado) e escolha da leitura mais nova. */

const { isRecord, RATE, LOCAL_MOMENT, isPayoutPerson } = require('./repasse.model.comum');

const MONEY = /^-?\d{1,18}\.\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(['rascunho', 'confirmada', 'descartada']);
const ADJUSTMENTS = new Set(['bonus', 'outro', 'desconto']);

const isText = (v) => typeof v === 'string';
const isMoney = (v) => isText(v) && MONEY.test(v);
const isDay = (v) => isText(v) && DAY.test(v);
const isInstallment = (v) => isRecord(v) && isDay(v.date) && isMoney(v.amount);
const isDebt = (v) => isRecord(v) && isText(v.id) && (v.kind === 'loan' || v.kind === 'advance') && isMoney(v.remaining)
  && (v.originalDeliveryOn === null || isDay(v.originalDeliveryOn)) && isText(v.sheetRef) && isText(v.status)
  && (v.corrects === null || isText(v.corrects)) && Array.isArray(v.installments) && v.installments.every(isInstallment);
const isAdjustment = (v) => isRecord(v) && isText(v.id) && isText(v.kind) && ADJUSTMENTS.has(v.kind) && isMoney(v.amount)
  && isText(v.description) && isDay(v.date);
const isDifference = (v) => isRecord(v) && isText(v.id) && isText(v.description) && (v.amount === null || isMoney(v.amount))
  && (v.resolvedAt === null || isText(v.resolvedAt)) && (v.resolvedBy === null || isPayoutPerson(v.resolvedBy));

function isOpening(v) {
  if (!isRecord(v) || !isText(v.id) || !isText(v.tarotId) || !Number.isInteger(v.revision) || !isText(v.status) || !STATUSES.has(v.status)) return false;
  if (!(v.corrects === null || Number.isInteger(v.corrects)) || !(v.correctionReason === null || isText(v.correctionReason))) return false;
  const ultimo = v.lastPayment;
  if (!isRecord(ultimo) || !isDay(ultimo.paidOn) || !isMoney(ultimo.amount) || !isText(ultimo.sheetRef)) return false;
  if (!isText(v.settledThrough) || !LOCAL_MOMENT.test(v.settledThrough) || !isText(v.migrationCut) || !LOCAL_MOMENT.test(v.migrationCut)) return false;
  if (!isMoney(v.remainingBalance) || !(v.remainingBalanceNote === null || isText(v.remainingBalanceNote)) || !isText(v.rate) || !RATE.test(v.rate)) return false;
  if (!Array.isArray(v.openAdjustments) || !v.openAdjustments.every(isAdjustment) || !Array.isArray(v.debts) || !v.debts.every(isDebt)) return false;
  if (!Array.isArray(v.differences) || !v.differences.every(isDifference)) return false;
  return isPayoutPerson(v.enteredBy) && isText(v.enteredAt) && (v.confirmedBy === null || isPayoutPerson(v.confirmedBy)) && (v.confirmedAt === null || isText(v.confirmedAt));
}

/** Confere a forma do DTO `{ current, draft, revisions[] }`; devolve o corpo ou null. */
function parseOpenings(body) {
  if (!isRecord(body) || !('current' in body) || !('draft' in body) || !Array.isArray(body.revisions)) return null;
  const valido = (body.current === null || isOpening(body.current)) && (body.draft === null || isOpening(body.draft)) && body.revisions.every(isOpening);
  return valido ? body : null;
}

// Cada revisão só avança (rascunho, depois confirmada ou descartada) e novas só se somam: a soma diz qual leitura é a mais nova.
const progress = (dados) => dados.revisions.reduce((soma, item) => soma + (item.status === 'rascunho' ? 1 : 2), 0);

/** Entre a última leitura e a feita logo depois de uma gravação, a mais nova; no empate, a leitura. */
function newestOpenings(read, written) {
  return written !== null && progress(written) > progress(read) ? written : read;
}

module.exports = { parseOpenings, newestOpenings };
