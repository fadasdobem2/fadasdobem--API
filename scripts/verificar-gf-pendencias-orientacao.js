'use strict';

/**
 * Verifica a pendência `guidance:` no servidor (Maturacao/41) contra o ouro do CÓDIGO REAL do front
 * (scripts/apoio-gf-pendencias/ouro-orientacao-front.json): o que a tela deriva (`financialGuidancePendingItems`), a semente
 * (`seedFinancialGuidanceRouting`) e a resolução (`reconcilePending`) passam; mutantes (fantasma, snapshot adulterado, resolver à força) são recusados.
 * Offline: `node scripts/verificar-gf-pendencias-orientacao.js`. Regerar o ouro: scripts/gerar-ouro-gf-pendencias-orientacao.js --front=<pasta>.
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const origem = require('../src/gestao-fadas/_comum/dominio/pendencias-origem');
const { itensDeOrientacao } = require('../src/gestao-fadas/_comum/dominio/pendencias-orientacao');
const dom = require('../src/gestao-fadas/_comum/dominio/pendencias');

const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-pendencias', 'ouro-orientacao-front.json'), 'utf8'));
const limpo = (v) => JSON.parse(JSON.stringify(v));
const ator = { id: '1', nome: 'Khloe', papel: 'atendente' };
const entrada = (orientacoes) => ({ consultas: [], agenda: [], pagamentos: [], divergencias: [], orientacoes });
const derivar = (orientacoes) => origem.derivar(entrada(orientacoes), { hoje: '2026-10-30', registros: [] });
const tenta = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
const gravar = (antes, pedido, o, agora = ouro.B) => { const saida = dom.aplicar(antes, pedido, ator, agora); origem.conferirOrigem(antes, pedido, saida, o); return saida; };

let itens = 0; let sementes = 0; let resolvidas = 0; let mutantes = 0;
ouro.cenarios.forEach((c, i) => {
  assert.deepStrictEqual(limpo(itensDeOrientacao(c.a)), c.itensA, `#${i} itens em A`);
  assert.deepStrictEqual(limpo(itensDeOrientacao(c.b)), c.itensB, `#${i} itens em B`);
  itens += c.itensA.length + c.itensB.length;
  const oA = derivar(c.a); const oB = derivar(c.b);
  assert.deepStrictEqual([...oA.fontes.values()].map((l) => l[0].id).sort(), c.itensA.map((s) => s.id).sort(), `#${i} fontes em A`);
  // Semente (registros novos sem evento) em A e em B.
  for (const [chave, r] of Object.entries(c.registrosA)) if (!r.events.length) { assert.equal(tenta(() => gravar(null, r, oA, ouro.A)), null, `#${i} semente A ${chave}`); sementes += 1; }
  for (const [chave, r] of Object.entries(c.registrosB)) {
    const antes = c.registrosA[chave] || null;
    if (antes && JSON.stringify(antes) === JSON.stringify(r)) continue;
    assert.equal(tenta(() => gravar(antes, r, oB)), null, `#${i} transição ${chave}`);
    if (!antes && !r.events.length) sementes += 1; else resolvidas += 1;
  }
});
console.log(`ouro da orientação: ${ouro.cenarios.length} cenários iguais ao código do front (${itens} pendências derivadas, ${sementes} sementes e ${resolvidas} resoluções aceitas)`);

// Mutantes sobre o primeiro cenário com pendência.
const base = ouro.cenarios.find((c) => c.itensA.length && Object.values(c.registrosA).some((r) => !r.events.length && !r.resolvedAt));
const oA = derivar(base.a);
const semente = Object.values(base.registrosA).find((r) => !r.events.length);
const mudaSnapshot = (campos) => { const snapshot = { ...semente.snapshot, ...campos }; return { ...semente, snapshot, key: JSON.stringify([snapshot.id, snapshot.occurrence]) }; };
const recusa = (nome, fn) => { const m = tenta(fn); assert.ok(m, `mutante aceito: ${nome}`); if (process.env.VERBOSO) console.log(' ', nome, '->', m); mutantes += 1; };
recusa('semente com detalhe adulterado', () => gravar(null, mudaSnapshot({ detail: 'Outro texto.' }), oA, ouro.A));
recusa('semente com nome adulterado', () => gravar(null, mudaSnapshot({ who: '1 · Fantasma' }), oA, ouro.A));
recusa('semente com pedido inexistente', () => gravar(null, mudaSnapshot({ occurrence: 'ev-inexistente' }), oA, ouro.A));
recusa('semente de cliente sem orientação', () => gravar(null, mudaSnapshot({ id: 'guidance:777' }), oA, ouro.A));
const resolvida = { ...semente, resolvedAt: ouro.B, events: [{ at: ouro.B, actor: { id: 'system', name: 'Sistema', role: 'administradora' }, action: 'resolved', from: 'supervisao', to: 'supervisao', reason: dom.MOTIVO_RESOLVIDA }] };
recusa('resolver à força quem ainda exige conferência', () => gravar(semente, resolvida, oA));
const comoOrigemSemFicha = origem.derivar({ consultas: [], agenda: [], pagamentos: [], divergencias: [] }, { hoje: '2026-10-30', registros: [] });
assert.equal(tenta(() => gravar(null, mudaSnapshot({ detail: 'Sem a ficha real lida, vale só a forma.' }), comoOrigemSemFicha, ouro.A)), null);
console.log(`mutantes recusados: ${mutantes}; sem a ficha real lida o servidor não confere (só forma e filas)`);
