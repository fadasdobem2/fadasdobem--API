'use strict';

/**
 * Consulta, vínculo de CONTINUAÇÃO no servidor (Maturacao/38). Porte de `tarologas/tarologist-metrics-model.ts` (`validateExtensionChanges`).
 * Puro; ouro do código real do front.
 */

const { erro } = require('./consulta-comum');

/** `validateExtensionChanges`: a origem e a continuação mantêm cliente e profissional, e a continuação começa depois do término da origem. */
function validarContinuacao(proxima, todas) {
  const registros = [...todas.filter((i) => i.id !== proxima.id), proxima];
  const relacionadas = registros.filter((i) => i.continuation && (i.id === proxima.id || i.continuation.sourceConsultationId === proxima.id));
  for (const item of relacionadas) {
    const origem = registros.find((k) => k.id === item.continuation.sourceConsultationId);
    if (!origem || origem.id === item.id || origem.clientId !== item.clientId || origem.tarotId !== item.tarotId) erro('A origem e a continuação precisam manter a mesma cliente e profissional.');
    if (!origem.endedAt || !Number.isFinite(Date.parse(origem.endedAt)) || !Number.isFinite(Date.parse(item.startedAt)) || Date.parse(origem.endedAt) > Date.parse(item.startedAt)) erro('A continuação precisa começar após o término da consulta de origem. Confira também os horários das continuações vinculadas.');
    let cursor = origem; const vistos = new Set([item.id]);
    while (cursor) {
      if (vistos.has(cursor.id)) erro('A consulta não pode ser continuação de si mesma.');
      vistos.add(cursor.id);
      const id = cursor.continuation && cursor.continuation.sourceConsultationId;
      cursor = id ? registros.find((k) => k.id === id) : undefined;
    }
  }
}

module.exports = { validarContinuacao };
