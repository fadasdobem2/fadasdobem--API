'use strict';

/**
 * Regime Pré/Pós do cadastro (v711, código da Nice): `assertClientPaymentTransition` e `preserveClientPaymentProfile` de
 * features/clientes/client-registration-state.mjs. Pós antigo continua histórico; a única mudança é rumo ao Pré e é definitiva:
 * repetir o valor é sem efeito, qualquer outro destino que não seja Pré-pago é recusado (inclusive "não informado" -> Pós e Pós -> "não informado").
 * Pré -> Pós não existe. Substitui a regra de 08/11 que deixava um cadastro sem regime receber qualquer valor: o código dela vence.
 * Histórico e pendências anteriores não mudam com a troca (a troca só carimba `perfil_pagamento_em`).
 */

const PRE = 'Pré-pago';
const POS = 'Pós-pago';
const MENSAGEM = 'A cliente pode passar para Pré. Depois disso, não volta para Pós.';

/** `de` = regime gravado (null/'' = não informado); `para` = o pedido ('' ou null = não informado). */
function regimePodeMudar(de, para) {
  const antes = de || '';
  const depois = para || '';
  return antes === depois || depois === PRE;
}

/** Uma importação posterior não desfaz a passagem registrada para Pré: vale o perfil se há carimbo e ele é Pré ou posterior à aprovação da migração. */
function preservarRegimeNaImportacao(perfil, mudouEm, aprovadaEm) {
  return Boolean(mudouEm && (perfil === PRE || Date.parse(mudouEm) > Date.parse(aprovadaEm)));
}

module.exports = { MENSAGEM, POS, PRE, regimePodeMudar, preservarRegimeNaImportacao };
