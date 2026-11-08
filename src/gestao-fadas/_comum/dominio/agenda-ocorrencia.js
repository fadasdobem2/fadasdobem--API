'use strict';

/**
 * Identidade da OCORRÊNCIA do agendamento (domínio puro), Lilly/Site v710 da Nice. Porte de `features/agenda/agenda-occurrence.ts`
 * (`sameAgendaOccurrence`): um segundo horário explícito é outra consulta; um pedido sem horário ainda vigente mantém a identidade na virada do dia;
 * exato e aproximado no mesmo relógio não criam duas ocorrências. O relógio real é o próprio `agora` (sem calendário de demonstração). Ouro:
 * scripts/gerar-ouro-gf-lilly-v710.js (roda a função REAL do front).
 */

const { lerPlano, normalizarRelogio } = require('./agenda-etiqueta');
const { horarioPedido } = require('./fila-geral-base');

/** `occurrencePlan` + `occurrenceClock`. */
function relogioDaOcorrencia(item) {
  const plano = item.contactPlan ?? { who: 'staff', timing: item.scheduledTime ? 'exact' : item.requestedTime ? 'approximate' : 'none', time: item.scheduledTime || item.requestedTime };
  return plano.timing === 'none' ? '' : plano.timing === 'shift' ? `${normalizarRelogio((plano.shift && plano.shift.start) ?? '')}/${normalizarRelogio((plano.shift && plano.shift.end) ?? '')}` : normalizarRelogio(plano.time ?? '');
}

/** `sameAgendaOccurrence(a, b, today, now)`. */
function mesmaOcorrencia(a, b, hoje, agora) {
  const dataA = a.date || hoje; const dataB = b.date || hoje; const relogioA = relogioDaOcorrencia(a); const relogioB = relogioDaOcorrencia(b);
  if (relogioA && relogioB) return dataA === dataB && relogioA === relogioB;
  if (!relogioA && !relogioB) return (dataA <= hoje ? hoje : dataA) === (dataB <= hoje ? hoje : dataB);
  const comHora = relogioA ? a : b; const semHora = relogioA ? b : a;
  const dataComHora = comHora.date || hoje; const dataSemHora = semHora.date || hoje;
  if (dataSemHora > hoje) return false;
  if (dataComHora < hoje) return true;
  if (dataComHora !== hoje) return false;
  const devido = horarioPedido(comHora, hoje);
  return devido !== null && devido <= agora;
}

module.exports = { mesmaOcorrencia, relogioDaOcorrencia, lerPlano };
