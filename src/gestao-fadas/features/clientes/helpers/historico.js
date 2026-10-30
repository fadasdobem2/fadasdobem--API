'use strict';

/**
 * Alcance, busca e ordenação do histórico da ficha. Porta de: features/clientes/client-history-access.ts
 * (visibleClientHistory, searchAndSortClientHistory, validateHistoryAccessReason).
 */

const { normalizeSearch } = require('./valores');

/** Aplica o alcance do perfil ANTES de busca, ordenação e paginação. atendente 10, supervisora 20 (sem ampliação), demais completo. */
function visibleClientHistory(entries, role, expanded = false) {
  if (!['atendente', 'supervisora', 'assistente', 'administradora'].includes(role)) return [];
  const ordered = entries.filter((entry) => Number.isFinite(Date.parse(entry.at)))
    .slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (role === 'atendente') return ordered.slice(0, 10);
  if (role === 'supervisora' && !expanded) return ordered.slice(0, 20);
  return ordered;
}

/** Busca só dentro de um conjunto já autorizado. */
function searchAndSortClientHistory(entries, query, sort = 'recent', direction = 'asc') {
  const needle = normalizeSearch(query.trim());
  const rows = entries.filter((entry) => !needle || normalizeSearch([
    entry.title, entry.detail, entry.status, entry.actor, entry.channel,
    entry.status === 'Em curso' ? 'Em consulta' : '',
    entry.status === 'Finalizada pelo tarólogo' ? 'A conferir' : '',
  ].filter(Boolean).join(' ')).includes(needle));
  const stamp = (item) => Date.parse(item.calendarAt ?? item.at);
  const label = (item) => (item.status === 'Em curso' ? 'Em consulta' : item.status === 'Finalizada pelo tarólogo' ? 'A conferir' : item.status);
  const value = (item) => (sort === 'name' ? item.title : sort === 'channel' ? item.channel : sort === 'duration' ? item.durationMinutes
    : sort === 'amount' ? item.amount : sort === 'status' ? label(item) : stamp(item));
  return rows.sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === undefined || y === undefined) return x === undefined ? (y === undefined ? 0 : 1) : -1;
    const comparison = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true, sensitivity: 'base' });
    const descending = sort === 'recent' || (sort !== 'oldest' && direction === 'desc');
    return (descending ? -comparison : comparison) || stamp(b) - stamp(a) || a.id.localeCompare(b.id);
  });
}

/** Motivo da ampliação: aparado, de 1 a 500 caracteres. Lança Error com a mensagem da B. */
function validateHistoryAccessReason(reason) {
  const value = typeof reason === 'string' ? reason.trim() : '';
  if (!value) throw new Error('Informe o motivo para abrir o histórico completo.');
  if (value.length > 500) throw new Error('Descreva o motivo em até 500 caracteres.');
  return value;
}

module.exports = { searchAndSortClientHistory, validateHistoryAccessReason, visibleClientHistory };
