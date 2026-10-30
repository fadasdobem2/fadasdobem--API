'use strict';

/** Confere o preço da compra (referência da tela) e o lançamento do servidor contra o ouro do código real do front. */
const { lerOuro, conferir } = require('./comparar');
const P = require('../../src/gestao-fadas/_comum/dominio/pagamentos-preco');
const Lc = require('../../src/gestao-fadas/_comum/dominio/pagamentos-lancamento');
const { PRECOS_PADRAO } = require('../../src/gestao-fadas/_comum/dominio/financeiro-base');

function verificar() {
  const ouro = lerOuro('compra');
  let ok = 0; let recusas = 0; const falhas = [];
  ouro.cenarios.forEach((c, i) => {
    const dif = c.tipo === 'referencia'
      ? conferir(c, () => P.referenciaDePreco(c.valor, c.clientId, c.em, PRECOS_PADRAO, c.contexto, c.editando, c.metodo))
      : conferir(c, () => Lc.criarPagamento(c.entrada, c.cliente, c.ator, c.agora, c.id, c.vinculada, c.pricing));
    if (dif) falhas.push(`#${i} ${c.tipo}: ${dif}`); else { ok += 1; if (c.esperado.erro) recusas += 1; }
  });
  return { nome: 'compra (referência de preço e lançamento)', total: ouro.cenarios.length, ok, recusas, falhas, aceitos: ouro.cenarios.filter((c) => c.esperado.ok).length };
}
module.exports = { verificar };
