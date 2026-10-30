'use strict';

/** Confere as ocorrências financeiras do servidor contra o ouro do código real do front (registrar, atualizar, reconciliar, regularizar, contatar). */
const { lerOuro, conferir } = require('./comparar');
const O = require('../../src/gestao-fadas/_comum/dominio/pagamentos-ocorrencias');
const C = require('../../src/gestao-fadas/_comum/dominio/pagamentos-ocorrencias-conciliar');

const FUNCOES = { registrar: O.registrarOcorrencia, atualizar: O.atualizarOcorrencia, reconciliar: C.reconciliarOcorrencia, regularizar: C.regularizarOcorrencia, contatar: C.contatarOcorrencia };

function verificar() {
  const ouro = lerOuro('ocorrencias');
  let ok = 0; let recusas = 0; const falhas = [];
  ouro.cenarios.forEach((c, i) => {
    const { expectedPaymentVersion: _a, expectedConsultationVersion: _b, ...entrada } = c.entrada;
    const dif = conferir(c, () => FUNCOES[c.tipo](c.estado, entrada, c.ator, c.papel, c.em).payments);
    if (dif) falhas.push(`#${i} ${c.tipo}: ${dif}`); else { ok += 1; if (c.esperado.erro) recusas += 1; }
  });
  return { nome: 'ocorrencias', total: ouro.cenarios.length, ok, recusas, falhas, aceitos: ouro.cenarios.filter((c) => c.esperado.ok).length };
}
module.exports = { verificar };
