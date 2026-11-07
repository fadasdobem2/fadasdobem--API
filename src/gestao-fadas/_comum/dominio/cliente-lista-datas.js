'use strict';

/**
 * Recorte de datas da lista de Clientes por função (v706). Porta de `clientRolePolicy.dates`, `clientDateModes` e
 * `clientListRange` de features/clientes/client-workspace-model.ts. A v706 dá à atendente Hoje, Ontem e 7 dias (antes só
 * Hoje) e deixa de forçar a atendente em "hoje": vale o modo que a função pode pedir. Só os escopos reais (daily/live).
 */

const DATAS_POR_FUNCAO = (role) => (role === 'administradora' ? ['ontem', 'hoje', '7dias', 'data', 'periodo']
  : role === 'supervisora' ? ['ontem', 'hoje'] : role === 'assistente' ? ['3dias'] : ['hoje', 'ontem', '7dias']);

/** `shiftDateKey(dia, n)` e `today` vêm do chamador (calendário operacional da API). */
function clientListRange(role, mode, today, start, end, shiftDateKey) {
  if (role === 'assistente') return { start: shiftDateKey(today, -2), end: today };
  if (!DATAS_POR_FUNCAO(role).includes(mode)) return { start: today, end: today };
  if (mode === 'ontem') return { start: shiftDateKey(today, -1), end: shiftDateKey(today, -1) };
  if (mode === '7dias') return { start: shiftDateKey(today, -6), end: today };
  if (mode === 'data') return { start, end: start };
  if (mode === 'periodo') return start > end ? { start: end, end: start } : { start, end };
  return { start: today, end: today };
}

module.exports = { DATAS_POR_FUNCAO, clientListRange };
