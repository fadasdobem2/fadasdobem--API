'use strict';

/** O plano da lista que um perfil pode pedir (fatia de clientes.model.js). */

const { isRealDay, localOperationalDateKey, shiftDateKey, withinRealPeriod } = require('./helpers/valores');
const { emptyClientSearch, hasClientSearch } = require('./helpers/busca');
const { clientListRange: listRange } = require('../../_comum/dominio/cliente-lista-datas');
const { clientRolePolicy, permissionsFor } = require('./helpers/perfis');

const PAGE_SIZES = [20, 30, 50];
const DETAILED_SEARCH = ['q', 'name', 'phone', 'email', 'birthDate'];

/** Recorte de datas da lista por perfil (clientListRange da v706, em _comum/dominio/cliente-lista-datas.js). */
const clientListRange = (role, mode, today, start, end) => listRange(role, mode, today, start, end, shiftDateKey);

/**
 * A lista que um perfil pode pedir, ou por que não. Um campo em branco não é busca (hasClientSearch).
 * Retorna { plan } ou { denied: 'role' | 'scope' | 'input' }: role e scope viram 403 ACCESS_DENIED, input vira 400.
 * `query` = { mode, start, end, scope, situation, balance, q, id, name, phone, email, birthDate, sort, direction, page, pageSize }.
 */
function planRealClientList(role, query, nowLocal) {
  if (!permissionsFor(role).canReadRealClients) return { denied: 'role' };
  const policy = clientRolePolicy(role);
  const given = (value) => value !== undefined && value.trim() !== '';
  const { mode, start, end } = query;
  // O que a v608 não dá ao perfil é recusado, nunca estreitado em silêncio: a v608 só o estreita na tela (R19).
  if (role === 'assistente' && (mode !== undefined || start !== undefined || end !== undefined || DETAILED_SEARCH.some((key) => given(query[key])))) return { denied: 'scope' };
  if (mode !== undefined && !policy.dates.includes(mode)) return { denied: 'scope' };
  if (!policy.canSeeBalance && (query.balance !== undefined || query.sort === 'balance')) return { denied: 'scope' };
  const chosen = role === 'assistente' ? '3dias' : mode ?? 'hoje';
  if (chosen !== 'data' && chosen !== 'periodo') {
    // Uma data só vale com Data ou Período; para um perfil sem eles, é recorte fora da política.
    if (start !== undefined || end !== undefined) return { denied: policy.dates.includes('data') ? 'input' : 'scope' };
  } else {
    const last = chosen === 'data' ? end ?? start : end;
    if (start === undefined || last === undefined || !isRealDay(start) || !isRealDay(last) || (chosen === 'data' && last !== start)
      || !withinRealPeriod({ start, end: last })) return { denied: 'input' };
  }
  const pageSize = query.pageSize ?? policy.pageSize;
  const page = query.page ?? 1;
  if (!PAGE_SIZES.includes(pageSize) || !Number.isSafeInteger(page) || page < 1) return { denied: 'input' };
  const today = localOperationalDateKey(nowLocal);
  const range = clientListRange(role, chosen, today, start ?? today, end ?? start ?? today);
  // A assistente busca só pelo ID exato, que a v608 lê do campo único de busca.
  const search = role === 'assistente' ? { ...emptyClientSearch(), query: query.id ?? '' }
    : { query: query.q ?? '', id: query.id ?? '', name: query.name ?? '', phone: query.phone ?? '', email: query.email ?? '', birthDate: query.birthDate ?? '' };
  return {
    plan: {
      role, nowLocal, today, range: { mode: chosen, ...range },
      scope: query.scope ?? 'daily', situation: query.situation ?? 'todos', balance: query.balance ?? 'todos',
      search, searching: hasClientSearch(search), sort: query.sort ?? 'date', direction: query.direction ?? 'desc', page, pageSize,
    },
  };
}

module.exports = {
  clientListRange,
  planRealClientList,
};
