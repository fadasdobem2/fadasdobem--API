'use strict';

/** Confere a edição em planilha e a correção de pagamento do servidor contra o ouro do código real do front. */
const { lerOuro, conferir } = require('./comparar');
const S = require('../../src/gestao-fadas/_comum/dominio/pagamentos-planilha');
const C = require('../../src/gestao-fadas/_comum/dominio/pagamentos-correcao');

function verificar() {
  const ouro = lerOuro('planilha');
  let ok = 0; let recusas = 0; const falhas = [];
  ouro.cenarios.forEach((c, i) => {
    let dif;
    if (c.tipo === 'planilha') {
      const p = c.entrada.payments.find((x) => x.id === c.entrada.paymentId);
      dif = conferir(c.esperado.ok && c.esperado.ok.igual ? { esperado: { ok: p } } : c, () => S.corrigirNaPlanilha(c.entrada));
    } else dif = conferir(c.esperado.ok && c.esperado.ok.igual ? { esperado: { ok: c.antes } } : c, () => C.corrigirPagamento(c.antes, c.entrada, c.ator, c.agora, c.pricing));
    if (dif) falhas.push(`#${i} ${c.tipo}: ${dif}`); else { ok += 1; if (c.esperado.erro) recusas += 1; }
  });
  return { nome: 'planilha e correção de pagamento', total: ouro.cenarios.length, ok, recusas, falhas, aceitos: ouro.cenarios.filter((c) => c.esperado.ok).length };
}
module.exports = { verificar };
