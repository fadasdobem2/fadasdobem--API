'use strict';

/** Confere o domínio de movimento do servidor contra o ouro do código real do front (registrar, crédito restante, corrigir). */
const { lerOuro, conferir } = require('./comparar');
const livro = require('../../src/gestao-fadas/_comum/dominio/pagamentos-movimento');
const credito = require('../../src/gestao-fadas/_comum/dominio/pagamentos-credito');
const correcao = require('../../src/gestao-fadas/_comum/dominio/pagamentos-correcao-movimento');

function verificar() {
  const ouro = lerOuro('movimento');
  let ok = 0; let recusas = 0; const falhas = [];
  ouro.cenarios.forEach((c, i) => {
    let dif;
    if (c.tipo === 'registrar') dif = conferir(c, () => livro.registrarMovimento(c.antes, c.entrada, c.ator, c.id, c.agora));
    else if (c.tipo === 'credito') dif = conferir(c, () => credito.devolverCreditoRestante(c.antes, c.entrada, c.contexto, c.ator, c.id, c.agora));
    else dif = conferir(c, () => correcao.corrigirMovimento(c.antes, c.id, c.entrada, c.ator, c.agora, c.contexto || undefined));
    if (dif) falhas.push(`#${i} ${c.tipo}: ${dif}`); else { ok += 1; if (c.esperado.erro) recusas += 1; }
  });
  return { nome: 'movimento', total: ouro.cenarios.length, ok, recusas, falhas, aceitos: ouro.cenarios.filter((c) => c.esperado.ok).length };
}
module.exports = { verificar };
