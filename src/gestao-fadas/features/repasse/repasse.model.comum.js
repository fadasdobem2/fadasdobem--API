'use strict';

/** Pedaços comuns das regras do repasse: tipo registro, formatos e a pessoa que gravou. */

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const RATE = /^\d{1,3}\.\d{2}$/;
const LOCAL_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

const isPayoutPerson = (valor) => isRecord(valor) && typeof valor.accountId === 'string' && (valor.displayName === null || typeof valor.displayName === 'string');

module.exports = { isRecord, RATE, LOCAL_MOMENT, isPayoutPerson };
