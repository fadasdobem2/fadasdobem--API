'use strict';

/**
 * Porte de `features/shared/real-period.ts` (suspiro/B): a regra de período das leituras reais. É a MESMA de
 * `validacao.dataCivil/periodo` (verificada em scripts/verificar-gf-comum.js); aqui na forma booleana da B, para
 * quem precisa testar sem lançar. `shiftDateKey` da B = `dia-operacional.somarDias`.
 */

const { somarDias } = require('./dia-operacional');

/** O período mais longo, contando as duas pontas. */
const MAX_PERIOD_DAYS = 366;

/** Dia civil que existe, AAAA-MM-DD: "2026-02-30" é recusado, não "rolado". */
const isRealDay = (dia) => {
  if (typeof dia !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  try {
    return somarDias(dia, 0) === dia; // mês 13 não gera data na A (toISOString lança); na B "rola" e difere: ambos = recusado
  } catch (_e) {
    return false;
  }
};

/** `end` não antes de `start`, e no máximo 366 dias contando os dois. */
const withinRealPeriod = ({ start, end }) => start <= end && end <= somarDias(start, MAX_PERIOD_DAYS - 1);

module.exports = { MAX_PERIOD_DAYS, isRealDay, withinRealPeriod, shiftDateKey: somarDias };
