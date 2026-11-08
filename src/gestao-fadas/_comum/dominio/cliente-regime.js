'use strict';

/**
 * Regime Pré/Pós do cadastro (decisão da Nice, 08/11): a única mudança permitida é Pós -> Pré, e é definitiva. Pré -> Pós NÃO existe (nem
 * voltar um Pré para "não informado", que seria a porta dos fundos). Cadastro sem regime pode receber qualquer um; repetir o mesmo valor
 * é sem efeito. Histórico e pendências anteriores não mudam com a troca (a troca só carimba `perfil_pagamento_em`).
 * O front (client-field-model.ts, legacy-client-write.ts) só confere que o valor é "", Pré-pago ou Pós-pago: a regra de sentido é da API.
 */

const PRE = 'Pré-pago';
const POS = 'Pós-pago';
const MENSAGEM = 'Este cadastro é Pré e não volta a ser Pós. A mudança só vale de Pós para Pré.';

/** `de` = regime gravado (null/'' = não informado); `para` = o pedido ('' = limpar). */
function regimePodeMudar(de, para) {
  const antes = de || '';
  const depois = para || '';
  if (antes === depois) return true;
  return antes !== PRE;
}

module.exports = { MENSAGEM, POS, PRE, regimePodeMudar };
