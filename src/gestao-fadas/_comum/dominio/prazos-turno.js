'use strict';

/**
 * Fim do turno da leitora (domínio puro, Maturacao/56 grupo D). Porte de `painel/panel-reader-shift-end.ts` (`readerShiftEnd`): só APRESENTA o fim
 * conhecido do período vigente, não decide disponibilidade. `endingSoon` = faltam 15 min ou menos (`15*60_000`). Relógio injetado (`now`, ms).
 * A âncora do front (`professionalPeriodInstants(..., anchor)`) só desloca o período pelo calendário de demonstração, que não existe no servidor
 * (deslocamento 0): o período vem de `presenca-agenda.instantesDosPeriodos` (dia operacional 06h a 06h, São Paulo UTC-3 fixo).
 * LIMITE CONHECIDO: o rótulo usa UTC-3 fixo; antes de 2019 o Brasil teve horário de verão e o front (Intl) mostraria -2 no verão. Não afeta a operação atual.
 */

const pa = require('./presenca-agenda');
const t = require('./painel-tempo');

const FIM_DE_TURNO_MS = 15 * 60_000;

function fimDoTurnoDaLeitora(perfil, excecoes, date, now) {
  if (!perfil || !Number.isFinite(now)) return null;
  const dataEscala = perfil.presenceDate && perfil.presenceDate < date ? perfil.presenceDate : date;
  const escala = pa.escalaNaData(perfil, excecoes, dataEscala);
  const periodos = escala.instants ? [escala.instants] : pa.instantesDosPeriodos(escala.periods, dataEscala);
  const atual = periodos.find((p) => p.startsAt <= now && now < p.endsAt);
  if (!atual) return null;
  const falta = atual.endsAt - now;
  return { endsAt: atual.endsAt, remainingMinutes: Math.ceil(falta / 60_000), timeLabel: pa.formatarHora(t.relogioSP(atual.endsAt)), endingSoon: falta <= FIM_DE_TURNO_MS };
}

module.exports = { FIM_DE_TURNO_MS, fimDoTurnoDaLeitora };
