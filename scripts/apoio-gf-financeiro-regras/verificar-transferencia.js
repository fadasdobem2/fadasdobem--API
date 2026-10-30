'use strict';

/** Confere a transferência de saldo do servidor contra o ouro do código real do front. */
const { lerOuro, conferir } = require('./comparar');
const T = require('../../src/gestao-fadas/_comum/dominio/pagamentos-transferencia');

function verificar() {
  const ouro = lerOuro('transferencia');
  let ok = 0; let recusas = 0; const falhas = [];
  ouro.cenarios.forEach((c, i) => {
    const dif = c.tipo === 'disponivel'
      ? conferir(c, () => T.saldoTransferivel(c.clientId, c.estado, c.perfil, 2.96, c.em))
      : conferir(c, () => T.transferirSaldo(c.estado, c.entrada, c.contexto).payments);
    if (dif) falhas.push(`#${i} ${c.tipo}: ${dif}`); else { ok += 1; if (c.esperado.erro) recusas += 1; }
  });
  return { nome: 'transferencia', total: ouro.cenarios.length, ok, recusas, falhas, aceitos: ouro.cenarios.filter((c) => c.esperado.ok).length };
}
module.exports = { verificar };
