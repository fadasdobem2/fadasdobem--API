'use strict';

/**
 * Arredondamento de minutos de crédito (v706 da Nice). Porte de `features/domain/credit-minute-rounding.ts`:
 * `wholeCreditMinutes`, `creditRoundingForLots`, `creditRoundingMinutes`. O total disponível é arredondado UMA vez para cima (nunca compra a compra),
 * e só quando todas as origens têm minutos conhecidos. A fração autorizada não é lote, nem saldo transferível, nem minuto novo.
 * Ouro: scripts/gerar-ouro-gf-credito-v706.js. Puro; sem relógio.
 */

const EPSILON = 1e-7;

function minutosInteiros(minutos) {
  return Number.isFinite(minutos) && minutos > 0 ? Math.max(0, Math.ceil(minutos - EPSILON)) : 0;
}

/** Sobras de minutos que a cliente pode ganhar; `undefined` quando alguma origem não prova os minutos. */
function arredondamentoDosLotes(lotes) {
  const disponiveis = lotes.filter((l) => l.cents > 0);
  if (!disponiveis.length || disponiveis.some((l) => !l.minutesKnown || !Number.isSafeInteger(l.cents) || !Number.isFinite(l.minutes) || l.minutes <= 0 || !Number.isFinite(l.unitValue) || l.unitValue <= 0)) return undefined;
  const exato = disponiveis.reduce((s, l) => s + l.minutes, 0);
  const minutos = minutosInteiros(exato) - exato;
  return minutos > EPSILON ? { version: 1, minutes: minutos } : undefined;
}

/** Um aceite salvo vale só se bate com as origens completas capturadas. */
function minutosDeArredondamento(lotes, arredondamento) {
  const esperado = arredondamentoDosLotes(lotes);
  return arredondamento && arredondamento.version === 1 && esperado && Number.isFinite(arredondamento.minutes) && Math.abs(arredondamento.minutes - esperado.minutes) < EPSILON ? esperado.minutes : 0;
}

module.exports = { minutosInteiros, arredondamentoDosLotes, minutosDeArredondamento };
