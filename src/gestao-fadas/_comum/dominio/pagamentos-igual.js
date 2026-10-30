'use strict';

/**
 * Comparação por valor do registro do pagamento (Maturacao/42): chaves em ordem, `undefined` ignorado. Fora da comparação ficam o `id` dos eventos de
 * auditoria (o front o sorteia com `Date.now()` e aleatório) e o sinal do zero no texto da auditoria (`-0` não sobrevive ao JSON: o navegador escreve
 * "-0,00", o servidor, lendo do banco, "0,00"; é a mesma quantia).
 */
const estavel = (v) => {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
};
/** O motivo financeiro (`financialReason`) é capturado pelo navegador (o catálogo de motivos é estado local): fica fora da comparação e é copiado depois. */
const semMotivo = (m) => (m && typeof m === 'object' ? { ...m, financialReason: undefined } : m);
const normalizado = (p) => {
  if (!p || typeof p !== 'object') return p;
  const base = { ...p, financialReason: undefined, ...(Array.isArray(p.movements) ? { movements: p.movements.map(semMotivo) } : {}) };
  return Array.isArray(p.audit)
    ? { ...base, audit: p.audit.map((e) => ({ ...e, id: undefined, detail: typeof e.detail === 'string' ? e.detail.replace(/-0,00(?!\d)/g, '0,00') : e.detail })) } : base;
};
/** Os dois registros passam por JSON antes (o do banco já passou; o do navegador chegou por JSON). */
const viaJson = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const igual = (a, b) => estavel(normalizado(viaJson(a))) === estavel(normalizado(viaJson(b)));

module.exports = { estavel, igual, normalizado };
