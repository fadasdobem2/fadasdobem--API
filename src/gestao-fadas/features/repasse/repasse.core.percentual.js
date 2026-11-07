'use strict';

/** Percentual do repasse (R11): centésimos, comissão em centavos, instante local e percentual de cada consulta. */

const { legacyLocalDateTime } = require('./helpers/valores-legado');
const { localOperationalDateKey } = require('./helpers/datas');
const { ZERO } = require('./repasse.core.util');

const HALF = 5000n;
const SCALE = 10000n;
const MAX_RATE = 10000n;

/** Percentual DECIMAL(5,2) em centésimos de ponto: "30.00" vira 3000. De 0 a 100; zero é acordo válido. */
function rateHundredths(rate) {
  const m = /^(\d{1,3})\.(\d{2})$/.exec(rate);
  const valor = m ? BigInt(m[1] + m[2]) : null;
  if (valor === null || valor > MAX_RATE) throw new Error(`Percentual inválido: ${rate}`);
  return valor;
}

/** round_half_up(base × percentual / 100), em centavos. A base nunca é negativa (R12). */
function commissionCents(baseCents, rate) {
  if (baseCents < ZERO) throw new RangeError('A base do repasse não pode ser negativa.');
  return (baseCents * rateHundredths(rate) + HALF) / SCALE;
}

/** Instante local com "T", pelo mesmo leitor do DATETIME do legado; formato ou data impossível é erro. Fração zerada é o mesmo instante. */
function localKey(texto) {
  const chave = legacyLocalDateTime(texto);
  if (chave === null) throw new Error(`Instante local inválido: ${texto}`);
  return chave.replace(/\.0+$/, '');
}

// ---- Percentual de cada consulta (R11) ----

function sortedChanges(history) {
  const changes = history.map((item) => ({ from: localKey(item.effectiveFrom), rate: item.rate }));
  changes.sort((a, b) => a.from.localeCompare(b.from));
  changes.forEach((item) => rateHundredths(item.rate));
  for (let i = 1; i < changes.length; i++) {
    if (changes[i].from === changes[i - 1].from) throw new Error(`Duas alterações de percentual em ${changes[i].from}.`);
  }
  return changes;
}

/** Percentual vigente no instante local: antes de quitado_ate não há; depois, a última alteração até ele, ou a abertura. */
function rateAt(settledThrough, openingRate, changes, at) {
  if (at < settledThrough) return null;
  let rate = openingRate;
  for (const item of changes) {
    if (item.from > at) break;
    rate = item.rate;
  }
  return rate;
}

/**
 * Percentual de cada consulta pelo seu início (FR-023, R11). O histórico nunca é editado, então o resultado de uma
 * consulta já iniciada não muda. A consulta fica pendente de conferência quando começou depois de uma alteração no
 * mesmo dia operacional e o mesmo par cliente e tarólogo teve, naquele dia e antes da alteração, uma consulta com
 * outro percentual: pode ser a continuação dela. Sem cliente identificado não há par.
 *
 * agreement: { opening: { settledThrough, rate }, history: [{ rate, effectiveFrom }] }
 * consultations: [{ id, clientId, startedAtLocal }]  ->  Map id -> { status: 'known', rate } | { status: 'not-informed' }
 *   | { status: 'pending-review', reason: 'continuation' }
 */
function consultationRates(agreement, consultations) {
  const settledThrough = localKey(agreement.opening.settledThrough);
  const openingRate = agreement.opening.rate;
  rateHundredths(openingRate);
  // O percentual conferido vale desde quitado_ate; alteração com vigência anterior é do período quitado (PO, 2026-10-24).
  const changes = sortedChanges(agreement.history).filter((change) => change.from >= settledThrough);
  const items = consultations.map((item) => {
    const at = localKey(item.startedAtLocal);
    const rate = rateAt(settledThrough, openingRate, changes, at);
    return { ...item, at, day: localOperationalDateKey(at), rate, hundredths: rate === null ? null : rateHundredths(rate) };
  });

  const result = new Map();
  for (const item of items) {
    if (item.rate === null) {
      result.set(item.id, { status: 'not-informed' });
      continue;
    }
    const continuation = item.clientId !== null && items.some((origin) =>
      origin.clientId === item.clientId && origin.day === item.day && origin.at < item.at && origin.hundredths !== item.hundredths
      && changes.some((change) => origin.at < change.from && change.from <= item.at));
    result.set(item.id, continuation ? { status: 'pending-review', reason: 'continuation' } : { status: 'known', rate: item.rate });
  }
  return result;
}

module.exports = { rateHundredths, commissionCents, localKey, consultationRates };
