'use strict';

/**
 * Painel, equipe e presença (domínio puro, Maturacao/39). Porte versionado do CÓDIGO do front: `painel/panel-model.ts:27-48` (`panelPresenceTeam`),
 * `tarologas/tarologist-presence.ts:12-25` (`professionalLiveStatus`), `tarologist-consultation-session.ts:25` (`consultationClockRuns`),
 * `domain/consultation-active-state.ts` (`consultationIsOpen`), `domain/professional-schedule.ts` (via `presenca-agenda.escalaNaData`).
 * Relógio injetado: `hoje` (dia operacional de `agora`) entra como parâmetro, nada de `Date.now()`.
 * A ordem por nome usa `colacao-ptbr.js` (equivalente ao `localeCompare('pt-BR')` do front, sem ICU).
 */

const { escalaNaData } = require('./presenca-agenda');
const c = require('./consulta-comum');
const b = require('./fila-geral-base');
const t = require('./painel-tempo');
const { compararPtBR } = require('./colacao-ptbr');

/** `consultationIsOpen`: aberta e sem registro legado pendente de migração. */
const consultaAberta = (item, hoje) => !t.precisaMigracao(item, hoje) && item.status === 'Em curso' && !item.tarologistFinishReport;
/** `consultationClockRuns`. */
const relogioCorre = (item, hoje) => !t.precisaMigracao(item, hoje) && item.status === 'Em curso' && !item.awaitingTarologistStart && !c.aguardaConferencia(item) && !c.pausaAtiva(item);

/** `professionalLiveStatus` (a agenda vazia: reservas da fila geral não entram aqui, como em `panelPresenceTeam`). */
function estadoAoVivo(perfil, consultas, hoje, ignoradas = new Set()) {
  if (consultas.some((i) => !ignoradas.has(i.id) && i.tarotId === perfil.id && relogioCorre(i, hoje))) return 'Em consulta';
  if (consultas.some((i) => !ignoradas.has(i.id) && i.tarotId === perfil.id && consultaAberta(i, hoje) && c.pausaAtiva(i))) return 'Em pausa';
  if (perfil.registrationActive === false) return 'Offline';
  const turno = perfil.shiftStatus ?? (!perfil.online ? 'Offline' : perfil.status === 'Pausa' ? 'Em pausa' : 'Disponível');
  const continuacaoEnviada = consultas.some((i) => !ignoradas.has(i.id) && i.tarotId === perfil.id && i.status === 'Em curso' && i.awaitingTarologistStart && !i.tarologistFinishReport && (i.continuation || (i.coverage && i.coverage.kind === 'Complemento')));
  if (turno === 'Disponível' && (b.conflitoDeContinuacao(consultas, perfil.id) || continuacaoEnviada)) return 'Reservado';
  return turno;
}

const compararNomes = compararPtBR;

/** `panelPresenceTeam`: `contas` = `[{ tarotId, role, active, access }]` (conta da taróloga). */
function equipeDePresenca(perfis, excecoes, contas, consultas, data, { hoje, ignoradas = new Set(), retidas = new Set(), proprioId, proprioEstado } = {}) {
  const ativaOperacional = (p) => p.registrationActive !== false && !contas.some((a) => a.tarotId === p.id && a.role === 'tarologa' && !a.active && a.access !== 'Acesso pendente');
  return perfis.filter((p) => p.id !== b.FILA_GERAL && (ativaOperacional(p) || retidas.has(p.id))).map((p) => {
    const operacionalAtiva = ativaOperacional(p);
    const escala = escalaNaData(p, excecoes, data);
    const ocupada = consultas.some((i) => !ignoradas.has(i.id) && i.tarotId === p.id && relogioCorre(i, hoje));
    const pausada = consultas.some((i) => !ignoradas.has(i.id) && i.tarotId === p.id && consultaAberta(i, hoje) && c.pausaAtiva(i));
    const aoVivo = p.id === proprioId && proprioEstado ? proprioEstado : estadoAoVivo(p, consultas, hoje, ignoradas);
    const status = ocupada ? 'Em consulta' : pausada ? 'Em pausa' : escala.absent ? 'Ausente' : aoVivo;
    return { ...p, hours: escala.hours, status, operationalActive: operacionalAtiva, available: operacionalAtiva && status === 'Disponível' };
  }).sort((p, q) => Number(q.available) - Number(p.available) || compararNomes(p.name, q.name));
}

module.exports = { consultaAberta, relogioCorre, estadoAoVivo, equipeDePresenca, compararNomes };
