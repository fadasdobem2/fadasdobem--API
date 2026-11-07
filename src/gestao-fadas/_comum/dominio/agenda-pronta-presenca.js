'use strict';

/**
 * "Pode agora" só depois do início do turno (domínio puro), v706 da Nice. Porte de `features/agenda/reader-ready-presence.ts`
 * (`readerShiftStartedForQueue`, `readyContactError`) e de `readerStartedOperationalDay` (tarologas/reader-status-bar-model.ts:37).
 * Relógio injetado: `agora` (ms). Ouro: scripts/gerar-ouro-gf-agenda-pedido.js.
 */

const { contatoDe } = require('./agenda-contato');
const { FILA_GERAL } = require('./fila-geral-base');
const { hojeOperacional } = require('../dia-operacional');
const t = require('./painel-tempo');
const c = require('./consulta-comum');

const milissegundos = (v) => (v && Number.isFinite(Date.parse(v)) ? Date.parse(v) : undefined);
function duranteODia(valor, agora) {
  const em = milissegundos(valor);
  return em !== undefined && em <= agora && hojeOperacional(new Date(em)) === hojeOperacional(new Date(agora));
}
/** `consultationInProgress`: aberta e já iniciada (ou pausada). */
const emAndamento = (item, hoje) => !t.precisaMigracao(item, hoje) && item.status === 'Em curso' && !item.tarologistFinishReport && (!item.awaitingTarologistStart || Boolean(c.pausaAtiva(item)));

function iniciouODiaOperacional(perfil, consultas, agora) {
  if ([perfil.presenceConfirmedAt, perfil.shiftAvailableSince].some((v) => duranteODia(v, agora))) return true;
  if ((perfil.presenceHistory || []).some((e) => duranteODia(e.at, agora) && /^Disponível(?:\s|$)/.test(e.after))) return true;
  const hoje = hojeOperacional(new Date(agora));
  return consultas.some((i) => i.tarotId === perfil.id && !i.awaitingTarologistStart && (emAndamento(i, hoje) || duranteODia(i.tarologistStartedAt, agora) || (i.durationSeconds > 0 && duranteODia(i.startedAt, agora))));
}

function turnoIniciadoParaAFila(perfil, consultas, agora) {
  if (iniciouODiaOperacional(perfil, consultas, agora)) return true;
  // Perfis antigos podem estar online sem data; com um turno datado, a presença precisa ser confirmada de novo no dia operacional seguinte.
  const estado = perfil.shiftStatus ?? (perfil.online ? perfil.status : 'Offline');
  return (estado === 'Disponível' || estado === 'Em consulta') && !perfil.presenceConfirmedAt && !perfil.shiftAvailableSince
    && !(perfil.presenceHistory || []).some((e) => /^Disponível(?:\s|$)/.test(e.after));
}

function erroDePodeAgora(etiqueta, item, perfis, consultas, data, agora) {
  if (etiqueta !== 'Pode agora' || item.tarotId === FILA_GERAL) return undefined;
  const contato = contatoDe(item);
  if (contato.date === data && contato.tags.includes(etiqueta)) return undefined;
  const perfil = perfis.find((r) => r.id === item.tarotId);
  if (!perfil || !turnoIniciadoParaAFila(perfil, consultas, agora)) return `Aguarde o início do turno de ${(perfil && perfil.name) || 'quem vai atender'} para marcar “Pode agora”.`;
  return undefined;
}

module.exports = { iniciouODiaOperacional, turnoIniciadoParaAFila, erroDePodeAgora };
