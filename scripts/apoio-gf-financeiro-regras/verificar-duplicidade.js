'use strict';

/** Confere a duplicidade de pagamento do servidor contra o ouro do código real do front. */
const { lerOuro } = require('./comparar');
const D = require('../../src/gestao-fadas/_comum/dominio/pagamentos-duplicidade');

function verificar() {
  const ouro = lerOuro('duplicidade');
  let ok = 0; let recusas = 0; const falhas = [];
  ouro.cenarios.forEach((c, i) => {
    let obtido = null;
    try { D.conferirDuplicidade(c.registro, c.existentes, c.agora); } catch (e) { obtido = e.message; }
    if (c.esperado.erro !== undefined) { if (obtido === c.esperado.erro) { ok += 1; recusas += 1; } else falhas.push(`#${i}: front recusa "${c.esperado.erro}"; servidor ${obtido === null ? 'aceitou' : `"${obtido}"`}`); }
    else if (obtido !== null) falhas.push(`#${i}: front aceita; servidor recusa "${obtido}"`); else ok += 1;
  });
  return { nome: 'duplicidade de pagamento', total: ouro.cenarios.length, ok, recusas, falhas, aceitos: ouro.cenarios.filter((c) => c.esperado.ok).length };
}
module.exports = { verificar };
