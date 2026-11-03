'use strict';

/**
 * Painel / Fila geral, tempo (domínio puro, Maturacao/39). Porte versionado do CÓDIGO do front do suspiro:
 * `operation-calendar.ts:20` (`operationToday`), `formatters.ts` (`saoPauloOperationalDateKey`), `queue-timing.ts:60-66` (`agendaOriginalQueueEntryAt`),
 * `agenda-contact-plan.ts:Label`, `panel-flow-model.ts:45` (`elapsedLabel`), `consultation-migration-state.ts`.
 * O RELÓGIO É SEMPRE INJETADO (`agora`, em ms): nada aqui chama `Date.now()` e nada usa Intl/ICU. São Paulo é UTC-3 fixo (sem horário de verão
 * desde 2019); o dia operacional vai de 06:00 a 06:00 (a hora local < 6 pertence ao dia anterior).
 */

const HORA_LOCAL_MS = 3 * 3600_000;
const DIA_MS = 86_400_000;
/** Janela de 15 min da Fila Geral (`generalQueueTiming`: pedido a até 15 min ainda conta como espera); fonte única, usada por `painel-fila-geral` e `painel-fluxo`. */
const JANELA_DE_ESPERA_MS = 15 * 60_000;

/** `saoPauloOperationalDateKey` para um instante em ms: a data de (instante - 3h - 6h), em UTC. */
const diaOperacionalDe = (ms) => new Date(ms - HORA_LOCAL_MS - 6 * 3600_000).toISOString().slice(0, 10);
/** `operationToday(now)` sem calendário de demonstração. */
const hojeDe = (agora) => diaOperacionalDe(agora);
/** Relógio civil de São Paulo "HH:MM" (equivale a pt-BR 2-digit h23). */
const relogioSP = (ms) => new Date(ms - HORA_LOCAL_MS).toISOString().slice(11, 16);
/** `shiftDateKey`. */
const somarDia = (chave, dias) => new Date(Date.parse(`${chave}T12:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);

/** `consultationNeedsMigration(item, today)`: registro antigo não resolvido nunca ocupa a operação de hoje. */
function precisaMigracao(item, hoje) {
  if (item.status !== 'Em curso' || item.endedAt || (item.tarologistFinishReport && item.tarologistFinishReport.endedAt) || item.migrationResolution) return false;
  if (item.migrationPending) return true;
  if (item.tarologistStartedAt) return false;
  const inicio = Date.parse(item.startedAt);
  return !Number.isFinite(inicio) || diaOperacionalDe(inicio) < hoje;
}

/** `agendaOriginalQueueEntryAt`: a entrada original na fila (`createdAt`, ou data+hora da linha). */
function entradaOriginal(item, data) {
  const criado = Date.parse(item.createdAt || '');
  if (Number.isFinite(criado)) return criado;
  if (!/^\d{2}:\d{2}$/.test(item.time)) return null;
  const valor = Date.parse(`${item.date || data}T${item.time}:00-03:00`) + (Number(item.time.slice(0, 2)) < 6 ? DIA_MS : 0);
  return Number.isFinite(valor) ? valor : null;
}

/** `agendaContactPlanLabel`. */
function rotuloDoPlano(item) {
  const plano = item.contactPlan;
  if (!plano) return item.scheduledTime ? `Às ${item.scheduledTime}` : item.requestedTime ? `Por volta de ${item.requestedTime}` : 'Sem horário';
  if (plano.timing === 'exact') return `Às ${plano.time}`;
  if (plano.timing === 'approximate') return `Por volta das ${plano.time}`;
  if (plano.timing === 'after') return `A partir das ${plano.time}`;
  if (plano.timing === 'shift' && plano.shift) { const horas = `${plano.shift.start} às ${plano.shift.end}`; return plano.shift.label === horas ? `Turno · ${horas}` : `${plano.shift.label} · ${horas}`; }
  return item.requestedTime || 'Sem horário';
}

/** `elapsedLabel`. */
function rotuloDecorrido(em, agora) {
  if (em === null || !Number.isFinite(em) || em > agora) return 'Horário não informado';
  const min = Math.floor((agora - em) / 60000);
  return min < 1 ? 'menos de 1 min' : min < 60 ? `${min} min` : min < 1440 ? `${Math.floor(min / 60)}h ${min % 60}min` : `${Math.floor(min / 1440)}d ${Math.floor(min % 1440 / 60)}h`;
}

module.exports = { DIA_MS, JANELA_DE_ESPERA_MS, diaOperacionalDe, hojeDe, relogioSP, somarDia, precisaMigracao, entradaOriginal, rotuloDoPlano, rotuloDecorrido };
