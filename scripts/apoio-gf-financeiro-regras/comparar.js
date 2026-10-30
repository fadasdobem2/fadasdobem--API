'use strict';

/** Comparação por valor dos registros (chaves em ordem, `undefined` ignorado); o `id` dos eventos de auditoria é sorteado pelo front e fica de fora. */
const estavel = (v) => {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
};
// `-0` não sobrevive ao JSON: o front escreve "-0,00" no texto da auditoria, o servidor (lendo do banco) "0,00". Mesma quantia.
const semIdsDeAuditoria = (p) => (p && Array.isArray(p.audit) ? { ...p, audit: p.audit.map((e) => ({ ...e, id: undefined, detail: typeof e.detail === 'string' ? e.detail.replace(/-0,00(?!\d)/g, '0,00') : e.detail })) } : p);
const igual = (a, b) => estavel(semIdsDeAuditoria(a)) === estavel(semIdsDeAuditoria(b));
const lerOuro = (area) => JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, `ouro-${area}-front.json`), 'utf8'));

/** Roda um cenário `{ esperado }` com `fn`; devolve null se igual ao front, senão a descrição da diferença. */
function conferir(c, fn) {
  let obtido;
  try { obtido = { ok: fn() }; } catch (e) { obtido = { erro: e && e.message, tipo: e && e.name }; if (e && e.name !== 'PagamentoInvalidoError') obtido.excecao = true; }
  if (c.esperado.erro !== undefined) {
    if (obtido.erro === c.esperado.erro && !obtido.excecao) return null;
    return `front recusa "${c.esperado.erro}"; servidor ${obtido.erro !== undefined ? `"${obtido.erro}"` : 'aceitou'}`;
  }
  if (obtido.erro !== undefined) return `front aceita; servidor recusa "${obtido.erro}"`;
  return igual(JSON.parse(JSON.stringify(obtido.ok === undefined ? null : obtido.ok)), c.esperado.ok) ? null : 'registro diferente do front';
}

module.exports = { estavel, igual, lerOuro, conferir };
