'use strict';

/**
 * Armazém de Adicionais (Maturacao/43): leitura das linhas de `gf_adicionais_itens` no formato do front (`PayoutAdditionStore`) e os registros que viajam
 * pelo HTTP (`{ key, kind, category | rule | occurrence, adjustment? }`). O lançamento (`adjustment`) de cada ocorrência lançada é DERIVADO (`ajusteDe`),
 * nunca guardado: o servidor o recalcula da regra, da data e da quantidade.
 */

const dom = require('../../_comum/dominio/adicionais');
const { f } = require('./estado.comum');

const TIPOS = { category: 'categoria', rule: 'regra', occurrence: 'ocorrencia' };
const chaveDe = (kind, id) => `${kind}:${id}`;

/** `linhas`: `[{ chave, tipo, item, version }]`. Devolve `{ loja, versoes, ajustes }`. */
function montar(linhas) {
  const versoes = {}; const por = { categoria: [], regra: [], ocorrencia: [] };
  for (const l of linhas) { por[l.tipo].push(f.textoDe(l)); versoes[l.chave] = Number(l.version); }
  const gravadas = new Map(por.categoria.map((c) => [c.id, c]));
  const categorias = [...dom.CATEGORIAS_PADRAO.map((c) => gravadas.get(c.id) || { ...c }), ...por.categoria.filter((c) => !dom.CATEGORIAS_PADRAO.some((p) => p.id === c.id))];
  for (const c of categorias) if (versoes[chaveDe('category', c.id)] === undefined) versoes[chaveDe('category', c.id)] = 1;
  const ocorrencias = [...por.ocorrencia].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const loja = { version: 1, categories: categorias, rules: por.regra, occurrences: ocorrencias };
  return { loja, versoes, ajustes: ajustesDe(loja) };
}

/** O lançamento de cada ocorrência lançada com `adjustmentId` próprio (`AJ-<id>`): fixa pela regra, por unidade pela quantidade conferida. */
function ajustesDe(loja) {
  return loja.occurrences.flatMap((o) => {
    const regra = loja.rules.find((r) => r.id === o.ruleId);
    if (!regra || o.status !== 'posted' || o.adjustmentId !== `AJ-${o.id}`) return [];
    if (regra.value.kind === 'unit' && !(o.quantity > 0)) return [];
    return [dom.ajusteDe(regra, o.date, o.resolvedBy || '', regra.value.kind === 'unit' ? o.quantity : undefined)];
  });
}

/** O registro HTTP de um item do armazém. */
function registro(loja, kind, id, ajustes) {
  if (kind === 'category') return { key: chaveDe(kind, id), kind, category: loja.categories.find((c) => c.id === id) };
  if (kind === 'rule') return { key: chaveDe(kind, id), kind, rule: loja.rules.find((r) => r.id === id) };
  const occurrence = loja.occurrences.find((o) => o.id === id);
  const adjustment = occurrence && occurrence.adjustmentId ? ajustes.find((a) => a.id === occurrence.adjustmentId) : undefined;
  return { key: chaveDe(kind, id), kind, occurrence, ...(adjustment ? { adjustment } : {}) };
}

/** Todos os registros na ordem do front (categorias, regras, ocorrências). */
const registros = (loja, ajustes) => [
  ...loja.categories.map((c) => registro(loja, 'category', c.id, ajustes)), ...loja.rules.map((r) => registro(loja, 'rule', r.id, ajustes)), ...loja.occurrences.map((o) => registro(loja, 'occurrence', o.id, ajustes)),
];

module.exports = { TIPOS, chaveDe, montar, ajustesDe, registro, registros };
