'use strict';

/** Cadeia de minutos de uma consulta e das origens (porte de `chainMinutes`, server/lilly/consultation-closing.mjs). Só consultas fechadas, da mesma cliente e tarólogo. */

const { sha, fechada } = require('./fechamento.tempo');

const chave = (v) => (v == null ? '' : String(v));
const origemDe = (c) => chave(c.continuation && c.continuation.sourceConsultationId);

function cadeiaDeMinutos(todas, linha) {
  const vistos = new Set(); const cadeia = []; let atual = linha;
  while (atual) {
    if (vistos.has(chave(atual.id)) || chave(atual.clientId) !== chave(linha.clientId) || chave(atual.tarologistId) !== chave(linha.tarologistId) || !fechada(atual)) return null;
    vistos.add(chave(atual.id)); cadeia.push(atual);
    const pai = origemDe(atual);
    if (!pai) break;
    atual = todas.find((c) => chave(c.id) === pai);
    if (!atual) return null;
  }
  const minutos = cadeia.map((c) => (Number.isFinite(c.performedDurationSeconds) ? c.performedDurationSeconds / 60 : Number.isFinite(c.tarologistFinishReport && c.tarologistFinishReport.minutes) ? c.tarologistFinishReport.minutes : Number.isFinite(c.durationSeconds) ? c.durationSeconds / 60 : null));
  if (!minutos.every((m) => m !== null && m >= 0)) return null;
  return {
    total: minutos.reduce((a, b) => a + b, 0), count: cadeia.length, rootConsultationId: chave(cadeia[cadeia.length - 1].id),
    fingerprint: sha(cadeia.map((c, i) => ({ id: chave(c.id), parent: origemDe(c), clientId: chave(c.clientId), tarologistId: chave(c.tarologistId), status: c.status, minutes: minutos[i] }))),
  };
}

module.exports = { cadeiaDeMinutos };
