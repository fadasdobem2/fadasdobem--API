'use strict';

/** Confere a conciliação de datas de migração do servidor contra o ouro do código real do front. */
const { lerOuro, conferir } = require('./comparar');
const D = require('../../src/gestao-fadas/_comum/dominio/pagamentos-datas');

function verificar() {
  const ouro = lerOuro('datas');
  let ok = 0; let recusas = 0; const falhas = [];
  ouro.cenarios.forEach((c, i) => {
    const dif = conferir(c, () => D.corrigirDatasDaMigracao(c.estado, c.entrada, c.papel, c.ator, c.em).payments);
    if (dif) falhas.push(`#${i} ${c.tipo}: ${dif}`); else { ok += 1; if (c.esperado.erro) recusas += 1; }
  });
  return { nome: 'datas de migração (informedAt)', total: ouro.cenarios.length, ok, recusas, falhas, aceitos: ouro.cenarios.filter((c) => c.esperado.ok).length };
}
module.exports = { verificar };
