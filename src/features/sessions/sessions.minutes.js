'use strict';

/**
 * Minutos de cobrança a partir de relógio do servidor (função pura).
 * Regra vigente (inalterada): minuto incompleto não conta (arredonda para baixo), os primeiros
 * `introFree` minutos são cortesia e o restante é pago. O "+2 final" e a fração por segundo
 * dependem de decisão da Nice e NÃO estão aqui.
 */

/**
 * @param {Date|string|number|null} startedAt
 * @param {Date|string|number|null} endedAt  (usar `Date.now()` no tick; `ended_at` no encerramento)
 * @param {number} introFree minutos de cortesia inicial
 * @returns {{ elapsedMinutes: number, freeUsed: number, paidUsed: number }}
 */
function computeBillableMinutes(startedAt, endedAt, introFree) {
  const s = startedAt ? new Date(startedAt).getTime() : NaN;
  const e = endedAt ? new Date(endedAt).getTime() : NaN;
  if (!Number.isFinite(s) || !Number.isFinite(e)) return { elapsedMinutes: 0, freeUsed: 0, paidUsed: 0 };
  const intro = Math.max(0, Math.floor(Number(introFree) || 0));
  const elapsedMinutes = Math.max(0, Math.floor((e - s) / 60000));
  return {
    elapsedMinutes,
    freeUsed: Math.min(intro, elapsedMinutes),
    paidUsed: Math.max(0, elapsedMinutes - intro),
  };
}

module.exports = { computeBillableMinutes };
