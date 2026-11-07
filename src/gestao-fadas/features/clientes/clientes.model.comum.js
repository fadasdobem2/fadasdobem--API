'use strict';

/** Constantes e utilitários comuns às regras de clientes (fatia de clientes.model.js). */

const ZERO = BigInt(0);
/** Intervalo que cabe qualquer história: o corte I14 mantém toda consulta com início e nenhuma como "aberta-antes". */
const WHOLE_HISTORY = { start: '0001-01-01', end: '9999-12-31' };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const allReceiptRows = (sources) => [...sources.informed, ...sources.confirmed, ...sources.notFound];


/** Ordem "recente" da v608: o início mais novo primeiro, desempate por ID. */
const newestFirst = (a, b) => cmp(b.startedAtLocal ?? '', a.startedAtLocal ?? '') || a.id.localeCompare(b.id);

function firstOfEach(items, key) {
  const first = new Map();
  for (const item of items) {
    const value = key(item);
    if (value !== null && !first.has(value)) first.set(value, item);
  }
  return first;
}

module.exports = {
  ZERO,
  WHOLE_HISTORY,
  cmp,
  allReceiptRows,
  newestFirst,
  firstOfEach,
};
