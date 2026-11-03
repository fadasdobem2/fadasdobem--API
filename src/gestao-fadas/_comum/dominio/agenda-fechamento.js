'use strict';

/**
 * Agenda, "Fechar agenda deste turno" (domínio puro, Maturacao/56 "Correções da onda 1 - grupo C", C3). Porte versionado de
 * `agenda/agenda-intake-context.tsx:currentClosurePeriod` (:35-48) e `saveControl` (:74-80), sem o calendário de demonstração:
 * o turno vigente vem da confirmação de presença, da janela de retorno ou da escala do dia (exceção vence a escala habitual), nunca do navegador.
 * O fim do turno (`closedUntil`) e o relógio do fim (`endTime`) são os do turno vigente. Relógio injetado (`agora`, ms).
 */

const { relogio, periodosNaData, instantesDosPeriodos } = require('./presenca-agenda');

const TURNO_ENCERRADO = 'Este turno já terminou. Confira o período de fechamento.';

/** `currentClosurePeriod`: `{ start, end, startsAt, endsAt }` do turno em andamento, ou undefined. `data` = dia operacional. */
function turnoVigente(perfil, excecoes, data, agora) {
  if (!perfil) return undefined;
  const confirmado = perfil.presenceConfirmedPeriod;
  const explicito = confirmado && confirmado.date === data ? confirmado
    : perfil.presenceDate === data && perfil.expectedReturn && perfil.returnUntil ? { startAt: perfil.expectedReturn, endAt: perfil.returnUntil } : undefined;
  if (explicito) {
    const ini = Date.parse(explicito.startAt); const fim = Date.parse(explicito.endAt);
    if (ini <= agora && fim > agora) return { start: relogio(ini), end: relogio(fim), startsAt: ini, endsAt: fim };
  }
  return instantesDosPeriodos(periodosNaData(perfil, excecoes || {}, data), data).find((p) => p.startsAt <= agora && p.endsAt > agora);
}

module.exports = { turnoVigente, TURNO_ENCERRADO };
