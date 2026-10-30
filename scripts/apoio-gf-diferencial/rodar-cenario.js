'use strict';

/** Roda um cenário de `cenarios-store.js` numa loja (da A ou da B) sobre o banco falso e devolve saídas, traço e tabelas. */

const { criarBanco } = require('./banco-falso');

const codigoDe = (e) => (e && (e.codigo || e.code)) || String(e && e.message);

/** `criarLoja(banco, { agora, novoId, legado })` devolve as 5 operações do store. */
async function rodarCenario(cenario, criarLoja) {
  const banco = criarBanco(cenario.opcoes);
  let relogio = 1_700_000_000_000;
  let seq = 0;
  const loja = criarLoja(banco, {
    agora: () => (relogio += 1000), novoId: () => `id-${++seq}`, legado: { tarologoExiste: async (id) => banco.tarologos.has(id) },
  });
  const saidas = [];
  for (const [i, passo] of cenario.passos.entries()) {
    banco.eventos.push({ tipo: 'passo', nome: `${i}:${passo.op}` });
    if (passo.antes) passo.antes(banco);
    const entrada = typeof passo.entrada === 'function' ? passo.entrada(saidas) : passo.entrada;
    try {
      saidas.push({ ok: await loja[passo.op](structuredClone(entrada)) });
    } catch (e) {
      saidas.push({ erro: codigoDe(e) });
    }
    if (passo.depois) passo.depois(banco);
  }
  // A conferência da conta que assina (ACCOUNT_EXISTS) é só da A (a B confia na FK); fica fora da comparação.
  const eventos = banco.eventos.filter((e) => e.nome !== 'ACCOUNT_EXISTS');
  return { saidas, eventos, tabelas: banco.t };
}

module.exports = { rodarCenario };
