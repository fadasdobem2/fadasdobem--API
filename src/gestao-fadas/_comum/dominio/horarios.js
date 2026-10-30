'use strict';

/**
 * Domínio puro dos horários, porte versionado de `features/domain/schedule-overrides.ts` do front do suspiro
 * (`storeScheduleOverride`, chaves de armazenamento) mais o token de revisão por tarólogo. Sem banco, sem Express.
 * Se o front mudar a regra, regerar os casos de `scripts/verificar-gf-horarios.js`.
 */

const { createHash } = require('crypto');

/** `shiftDateKey` do front: soma dias a uma data civil AAAA-MM-DD. */
function somarDias(data, dias) {
  const [a, m, d] = data.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + dias, 12));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

const chaveDoDia = (tarotId, data) => `${tarotId}@${data}`;
const chaveDe = (tarotId, r) => (r.startDate === r.endDate ? chaveDoDia(tarotId, r.startDate) : `${tarotId}@${r.startDate}..${r.endDate}`);
const pertence = (chave, tarotId) => chave === tarotId || chave.startsWith(`${tarotId}@`);

/** `storeScheduleOverride` do front: grava `registro` e preserva só os trechos das exceções antigas fora do intervalo novo. */
function guardarExcecao(registros, tarotId, registro, substitui) {
  const mantidos = { ...registros };
  if (substitui && pertence(substitui, tarotId)) delete mantidos[substitui];
  if (registro.startDate === registro.endDate) return { ...mantidos, [chaveDoDia(tarotId, registro.startDate)]: registro };
  for (const [chave, anterior] of Object.entries(mantidos)) {
    if (!pertence(chave, tarotId) || anterior.endDate < registro.startDate || anterior.startDate > registro.endDate) continue;
    delete mantidos[chave];
    const manter = (startDate, endDate) => {
      const parte = { ...anterior, startDate, endDate, noteStartDate: anterior.noteStartDate ?? anterior.startDate, noteEndDate: anterior.noteEndDate ?? anterior.endDate };
      const chaveParte = chaveDe(tarotId, parte);
      if (startDate !== endDate || !mantidos[chaveParte]) mantidos[chaveParte] = parte;
    };
    if (anterior.startDate < registro.startDate) manter(anterior.startDate, somarDias(registro.startDate, -1));
    if (anterior.endDate > registro.endDate) manter(somarDias(registro.endDate, 1), anterior.endDate);
  }
  return { ...mantidos, [chaveDe(tarotId, registro)]: registro };
}

/** Token de concorrência de um tarólogo: muda sempre que o conjunto de exceções ativas muda (gravar cria linhas, remover as marca). */
function revisaoDe(idsAtivos) {
  return createHash('sha1').update([...idsAtivos].sort().join('|'), 'utf8').digest('hex').slice(0, 16);
}

/** Mesmo `parseWorkPeriods` do front, só para validar o texto do horário habitual. */
function periodosDoTexto(texto) {
  return [...String(texto).matchAll(/(\d{1,2})(?:(?:h|:)(\d{2})|h)?\s*(?:às|a|-)\s*(\d{1,2})(?:(?:h|:)(\d{2})|h)?/gi)]
    .map((m) => ({ start: `${m[1].padStart(2, '0')}:${m[2] || '00'}`, end: `${m[3].padStart(2, '0')}:${m[4] || '00'}` }));
}

module.exports = { somarDias, chaveDoDia, chaveDe, pertence, guardarExcecao, revisaoDe, periodosDoTexto };
