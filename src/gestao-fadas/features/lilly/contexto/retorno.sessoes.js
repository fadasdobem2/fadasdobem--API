'use strict';

/**
 * Sessões de atendimento e retorno da cliente ao MESMO profissional. Porte de `buildSessionMetricIndex`/`summarize` de
 * `features/tarologas/tarologist-session-metrics.ts` e de `metricAttended`/`continuationSource` de `tarologist-metrics-model.ts` (v708 da Nice).
 * Puro (sem banco, sem relógio). Uma sessão = uma consulta RAIZ mais as continuações vinculadas (mesma cliente e profissional): três lançamentos
 * seguidos de 15 minutos são UM atendimento e não geram retornos artificiais. Uma sessão é "de retorno" quando a cliente já tinha concluído
 * (`endedAt`) outra sessão com o mesmo profissional até o início desta.
 * Registro de entrada: `{ id, tarotId, clientId, status, awaitingTarologistStart, durationSeconds, startedAt, endedAt?, continuation?, coverage? }`.
 */

const { contaMinutos } = require('../../../_comum/dominio/financeiro-base');

const instante = (v) => (typeof v === 'string' ? Date.parse(v) : NaN);

/** `metricAttended`: a consulta conta como atendida (status que conta minutos, já iniciada pelo profissional, com duração). */
const atendida = (r) => contaMinutos(r.status) && !r.awaitingTarologistStart && Number.isFinite(r.durationSeconds) && r.durationSeconds > 0;

const origemDe = (r) => (r.coverage && r.coverage.kind === 'Complemento' ? r.coverage.sourceConsultationId : r.continuation && r.continuation.sourceConsultationId);

/**
 * @param {object[]} registros
 * @param {(iso: string) => string} diaDe  dia operacional (AAAA-MM-DD) de um instante
 * @returns {{ id, tarotId, clientId, startedAt, date, returning }[]}
 */
function sessoesDe(registros, diaDe) {
  const porId = new Map(registros.map((r) => [r.id, r]));
  const cache = new Map();
  function raizDe(item) {
    const caminho = []; const vistos = new Set();
    let raiz = item;
    for (;;) {
      if (cache.has(raiz.id)) {
        const guardada = cache.get(raiz.id);
        if (!guardada) { for (const m of caminho) cache.set(m.id, null); return undefined; }
        raiz = guardada; break;
      }
      if (vistos.has(raiz.id)) { for (const m of caminho) cache.set(m.id, null); return undefined; }
      caminho.push(raiz); vistos.add(raiz.id);
      const origem = porId.get(origemDe(raiz));
      if (!origem || origem.tarotId !== item.tarotId || origem.clientId !== item.clientId) break;
      raiz = origem;
    }
    for (const m of caminho) cache.set(m.id, raiz);
    return raiz;
  }
  const grupos = new Map();
  for (const item of porId.values()) {
    if (!atendida(item) || !Number.isFinite(instante(item.startedAt))) continue;
    const raiz = raizDe(item);
    if (!raiz || !atendida(raiz) || !Number.isFinite(instante(raiz.startedAt))) continue; // origem anulada ou não confirmada não vira consulta independente
    const g = grupos.get(raiz.id) || { raiz, membros: [] };
    g.membros.push(item); grupos.set(raiz.id, g);
  }
  const primeiraConcluida = new Map();
  return [...grupos.values()].sort((a, b) => instante(a.raiz.startedAt) - instante(b.raiz.startedAt) || (a.raiz.id < b.raiz.id ? -1 : 1)).map(({ raiz, membros }) => {
    const chave = `${raiz.tarotId}:${raiz.clientId}`;
    const inicio = instante(raiz.startedAt);
    const retorno = (primeiraConcluida.get(chave) ?? Infinity) <= inicio;
    const fins = membros.map((m) => (m.endedAt ? instante(m.endedAt) : NaN)).filter((fim, n) => Number.isFinite(fim) && fim >= instante(membros[n].startedAt));
    if (fins.length) primeiraConcluida.set(chave, Math.min(primeiraConcluida.get(chave) ?? Infinity, ...fins));
    return { id: raiz.id, tarotId: raiz.tarotId, clientId: raiz.clientId, startedAt: raiz.startedAt, date: diaDe(raiz.startedAt), returning: retorno };
  });
}

/** `summarize` por profissional, no intervalo de dias (inclusive): clientes únicas e as que voltaram. Sem sessão, o profissional NÃO aparece (nunca 0). */
function linhasPorProfissional(sessoes, inicio, fim) {
  const porTarot = new Map();
  for (const s of sessoes) {
    if (s.date < inicio || s.date > fim) continue;
    const g = porTarot.get(s.tarotId) || { clientes: new Set(), voltaram: new Set() };
    g.clientes.add(s.clientId);
    if (s.returning) g.voltaram.add(s.clientId);
    porTarot.set(s.tarotId, g);
  }
  return [...porTarot.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([tarologistId, g]) => ({
    tarologistId, returnPercentage: (g.voltaram.size / g.clientes.size) * 100, clients: g.clientes.size, returningClients: g.voltaram.size,
  }));
}

module.exports = { sessoesDe, linhasPorProfissional, atendida };
