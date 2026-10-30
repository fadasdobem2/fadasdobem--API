'use strict';

/**
 * Validação das entradas do repasse, porta do que a B confere em `real-payouts-http.server.ts` (zod `.strict()`) e nos
 * schemas de entrada de `db/finance-store.ts`. Nesta etapa só o ID do tarólogo é usado pelas rotas GET. Os
 * validadores de corpo ficam prontos (e verificados offline) para quando as GRAVAÇÕES forem liberadas; hoje nenhuma
 * rota os chama, porque os models `gf_repasse_*` são somente leitura (ver TODO em repasse.service.js).
 *
 * Regras mantidas da B: dinheiro só em TEXTO com 2 casas, sem zero à esquerda e sem "-0.00" (a repetição por
 * `operationKey` compara o corpo com o registro guardado); campo desconhecido é recusado; percentual de 0 a 100 com
 * até 2 casas, normalizado para 2 casas como o DECIMAL(5,2); fim do período quitado é sempre um corte das 6h.
 */

const AppError = require('../../../utils/AppError');
const { moneyToCents, sumCents } = require('./helpers/dinheiro');
const { isRealDay } = require('./helpers/datas');
const { legacyId } = require('./helpers/valores-legado');

const ZERO = 0n;

function invalido(campo) {
  return new AppError('Entrada inválida.', 400, { codigo: 'INVALID_INPUT', campo });
}

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v) => typeof v === 'string';

/** Objeto sem campo desconhecido (`.strict()`); `obrigatorios` precisam existir. */
function objetoExato(valor, obrigatorios, opcionais = [], campo = 'corpo') {
  if (!isRecord(valor)) throw invalido(campo);
  const permitidos = new Set([...obrigatorios, ...opcionais]);
  for (const chave of Object.keys(valor)) if (!permitidos.has(chave)) throw invalido(chave);
  for (const chave of obrigatorios) if (!(chave in valor) || valor[chave] === undefined) throw invalido(chave);
  return valor;
}

// ---- Segmentos de rota ----

/**
 * ID de tarólogo do legado como a B o escreve: "007" não acharia linha, então é recusado. Só TEXTO (o zod da B é
 * `z.string()`: o número 7 no corpo é recusado, não convertido). Devolve o texto.
 */
function idTarologo(valor, campo = 'id') {
  if (!isText(valor) || !/^[1-9]\d*$/.test(valor) || legacyId(valor) === null) throw invalido(campo);
  return valor;
}

/** ID de abertura (texto de 1 a 64 caracteres). */
function idAbertura(valor, campo = 'id') {
  if (!isText(valor) || valor.length < 1 || valor.length > 64) throw invalido(campo);
  return valor;
}

// ---- Formatos ----

const DAY = (v, campo) => {
  if (!isText(v) || !isRealDay(v)) throw invalido(campo);
  return v;
};
const LOCAL_INSTANT = (v, campo) => {
  if (!isText(v) || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(v) || !isRealDay(v.slice(0, 10))) throw invalido(campo);
  return v;
};
const MONEY = (v, campo) => {
  if (!isText(v) || !/^-?(?:0|[1-9]\d{0,17})\.\d{2}$/.test(v) || v === '-0.00') throw invalido(campo);
  return v;
};
const POSITIVE = (v, campo) => {
  if (moneyToCents(MONEY(v, campo)) <= ZERO) throw invalido(campo);
  return v;
};
const NOT_NEGATIVE = (v, campo) => {
  if (moneyToCents(MONEY(v, campo)) < ZERO) throw invalido(campo);
  return v;
};

/** Percentual de 0 a 100 com até 2 casas ("35", "35.5", "35.50"), normalizado com 2 casas. */
function RATE(v, campo = 'rate') {
  if (!isText(v) || !/^\d{1,3}(?:\.\d{1,2})?$/.test(v)) throw invalido(campo);
  const [inteiro, fracao = ''] = v.split('.');
  const normalizado = `${Number(inteiro)}.${fracao.padEnd(2, '0')}`;
  const [i, f] = normalizado.split('.');
  if (Number(i) * 100 + Number(f) > 10000) throw invalido(campo);
  return normalizado;
}

/** Texto obrigatório e não vazio (aparado), até `max`. */
function texto(v, max, campo) {
  if (!isText(v) || v.length > max || v.trim().length === 0) throw invalido(campo);
  return v;
}
/** Texto opcional: undefined/null viram null. */
function textoOpcional(v, max, campo) {
  return v === undefined || v === null ? null : texto(v, max, campo);
}

/** Chave da operação (idempotência): de 1 a 64 caracteres, sem espaço nas pontas. */
function operationKey(v) {
  if (!isText(v) || v.length < 1 || v.length > 64 || v.trim() !== v) throw invalido('operationKey');
  return v;
}

// ---- Acordo ----

const WEEKDAYS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta'];
const POLICIES = ['keep', 'next-business-day'];

function calendario(v) {
  if (!isRecord(v)) throw invalido('schedule');
  if (v.kind === 'weekday') {
    objetoExato(v, ['kind', 'weekday'], [], 'schedule');
    if (!WEEKDAYS.includes(v.weekday)) throw invalido('schedule.weekday');
    return { kind: 'weekday', weekday: v.weekday };
  }
  if (v.kind === 'monthdays') {
    objetoExato(v, ['kind', 'days', 'weekendPolicy'], [], 'schedule');
    if (!Array.isArray(v.days) || v.days.length < 1 || !v.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 31) || new Set(v.days).size !== v.days.length) throw invalido('schedule.days');
    if (!POLICIES.includes(v.weekendPolicy)) throw invalido('schedule.weekendPolicy');
    return { kind: 'monthdays', days: [...v.days], weekendPolicy: v.weekendPolicy };
  }
  if (v.kind === 'none') {
    objetoExato(v, ['kind'], [], 'schedule');
    return { kind: 'none' };
  }
  throw invalido('schedule.kind');
}

/** `POST /payouts/agreements/{tarotId}/commission`: `{ rate, reason?, operationKey }`. */
function corpoPercentual(body) {
  objetoExato(body, ['rate', 'operationKey'], ['reason']);
  return { rate: RATE(body.rate), reason: textoOpcional(body.reason, 500, 'reason'), operationKey: operationKey(body.operationKey) };
}

/** `POST /payouts/agreements/{tarotId}/schedule`: `{ schedule, reason?, operationKey }`. */
function corpoCalendario(body) {
  objetoExato(body, ['schedule', 'operationKey'], ['reason']);
  return { schedule: calendario(body.schedule), reason: textoOpcional(body.reason, 500, 'reason'), operationKey: operationKey(body.operationKey) };
}

// ---- Abertura ----

const ADJUSTMENT_KINDS = ['bonus', 'outro', 'desconto'];
const DEBT_KINDS = ['loan', 'advance'];

function listaDe(v, campo) {
  if (!Array.isArray(v)) throw invalido(campo);
  return v;
}

function camposAbertura(body, extras) {
  objetoExato(body, ['tarotId', 'lastPayment', 'settledThrough', 'remainingBalance', 'migrationCut', 'rate', 'openAdjustments', 'debts', 'differences', 'operationKey', ...extras],
    ['remainingBalanceNote']);
  const lastPayment = objetoExato(body.lastPayment, ['paidOn', 'amount', 'sheetRef'], [], 'lastPayment');
  const settledThrough = LOCAL_INSTANT(body.settledThrough, 'settledThrough');
  // O fim do período quitado é sempre um corte das 6h (FR-027): o dia seguinte ao último dia operacional quitado.
  if (!settledThrough.endsWith('T06:00:00')) throw invalido('settledThrough');
  const migrationCut = LOCAL_INSTANT(body.migrationCut, 'migrationCut');

  const openAdjustments = listaDe(body.openAdjustments, 'openAdjustments').map((item) => {
    objetoExato(item, ['kind', 'amount', 'description', 'date'], [], 'openAdjustments');
    if (!ADJUSTMENT_KINDS.includes(item.kind)) throw invalido('openAdjustments.kind');
    return { kind: item.kind, amount: MONEY(item.amount, 'openAdjustments.amount'), description: texto(item.description, 500, 'openAdjustments.description'), date: DAY(item.date, 'openAdjustments.date') };
  });
  const debts = listaDe(body.debts, 'debts').map((item) => {
    objetoExato(item, ['kind', 'remaining', 'sheetRef', 'installments'], ['originalDeliveryOn'], 'debts');
    if (!DEBT_KINDS.includes(item.kind)) throw invalido('debts.kind');
    const installments = listaDe(item.installments, 'debts.installments').map((p) => {
      objetoExato(p, ['date', 'amount'], [], 'debts.installments');
      return { date: DAY(p.date, 'debts.installments.date'), amount: POSITIVE(p.amount, 'debts.installments.amount') };
    });
    if (installments.length < 1) throw invalido('debts.installments');
    return {
      kind: item.kind, remaining: POSITIVE(item.remaining, 'debts.remaining'),
      originalDeliveryOn: item.originalDeliveryOn === undefined || item.originalDeliveryOn === null ? null : DAY(item.originalDeliveryOn, 'debts.originalDeliveryOn'),
      sheetRef: texto(item.sheetRef, 200, 'debts.sheetRef'), installments,
    };
  });
  const differences = listaDe(body.differences, 'differences').map((item) => {
    objetoExato(item, ['description'], ['amount'], 'differences');
    return {
      description: texto(item.description, 500, 'differences.description'),
      amount: item.amount === undefined || item.amount === null ? null : MONEY(item.amount, 'differences.amount'),
    };
  });

  // O que o formulário confere antes de enviar e o servidor confere de novo: o quitado antes do corte, as parcelas de
  // cada dívida somando o restante e nenhuma parcela antes do dia do corte da migração.
  const diaDoCorte = migrationCut.slice(0, 10);
  const consistente = settledThrough < migrationCut && debts.every((d) =>
    sumCents(d.installments.map((p) => p.amount)) === moneyToCents(d.remaining) && d.installments.every((p) => p.date >= diaDoCorte));
  if (!consistente) throw invalido('abertura');

  return {
    tarotId: idTarologo(body.tarotId, 'tarotId'),
    lastPayment: { paidOn: DAY(lastPayment.paidOn, 'lastPayment.paidOn'), amount: NOT_NEGATIVE(lastPayment.amount, 'lastPayment.amount'), sheetRef: texto(lastPayment.sheetRef, 200, 'lastPayment.sheetRef') },
    settledThrough, remainingBalance: MONEY(body.remainingBalance, 'remainingBalance'),
    remainingBalanceNote: textoOpcional(body.remainingBalanceNote, 2000, 'remainingBalanceNote'),
    migrationCut, rate: RATE(body.rate), openAdjustments, debts, differences, operationKey: operationKey(body.operationKey),
  };
}

/** `POST /payouts/openings`: rascunho da revisão 1. */
function corpoAbertura(body) {
  return camposAbertura(body, []);
}

/** `POST /payouts/openings/{id}/correct`: os mesmos campos mais `reason`. */
function corpoCorrecao(body) {
  const campos = camposAbertura(body, ['reason']);
  return { ...campos, reason: texto(body.reason, 500, 'reason') };
}

/** `POST /payouts/openings/{id}/confirm`: `{ operationKey }`. */
function corpoConfirmar(body) {
  objetoExato(body, ['operationKey']);
  return { operationKey: operationKey(body.operationKey) };
}

module.exports = {
  idTarologo, idAbertura, RATE, corpoPercentual, corpoCalendario, corpoAbertura, corpoCorrecao, corpoConfirmar,
};
