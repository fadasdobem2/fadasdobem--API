'use strict';

/**
 * Unicidade do pagamento da Lilly (Maturacao/59, R3; Maturacao/60, item 4), em `gf_lilly_pagamento_refs`:
 *  - pela REFERÊNCIA do provedor, cruzando os tipos como a Lilly (`samePayment`): qualquer valor de `reference`, `mpPaymentId`
 *    (`mercadoPagoId` é apelido), `externalTransactionId` ou `endToEndId` que coincida com QUALQUER campo de referência já gravado, ou o mesmo
 *    `sourceEventId`. Comparação sem caixa e sem espaços nas pontas;
 *  - por `proposalId` (uma proposta, um pagamento) e por `authorizedEventId` (uma autorização, um pagamento).
 * Conferir sob a trava consultiva do executor (`gf_lilly:pagamentos`), que serializa os pagamentos da Lilly.
 */

const { texto } = require('./executores.comum');

const COLUNAS_DE_REFERENCIA = ['reference', 'mp_payment_id', 'external_transaction_id', 'end_to_end_id'];
const norm = (v) => texto(v).toLowerCase();

/** Referências do payload, como vieram (aparadas). Devolve também o que não cabe nas colunas como `invalido`. */
function referenciasDe(p) {
  const r = {
    reference: texto(p.reference) || undefined, mpPaymentId: texto(p.mpPaymentId) || texto(p.mercadoPagoId) || undefined,
    externalTransactionId: texto(p.externalTransactionId) || undefined, endToEndId: texto(p.endToEndId) || undefined, sourceEventId: texto(p.sourceEventId) || undefined,
  };
  const invalido = (r.mpPaymentId && r.mpPaymentId.length > 100) || (r.endToEndId && r.endToEndId.length > 100)
    || (r.reference && r.reference.length > 200) || (r.externalTransactionId && r.externalTransactionId.length > 200) || (r.sourceEventId && r.sourceEventId.length > 200);
  return { refs: r, invalido: Boolean(invalido) };
}

const valoresDeReferencia = (r) => [...new Set([r.reference, r.mpPaymentId, r.externalTransactionId, r.endToEndId].filter(Boolean).map(norm))];

async function clienteDoPagamento(executor, paymentId) {
  const [l] = await executor.execute('SELECT id_cliente FROM gf_pagamentos WHERE id = ?', [paymentId]);
  return l[0] ? l[0].id_cliente : null;
}

/**
 * Procura conflito. Devolve `null` ou `{ tipo, paymentId, clientId }` com tipo `referencia` | `proposta` | `autorizacao`.
 * `ignorar`: o próprio pagamento (retomada de uma execução que já gravou o pagamento).
 */
async function buscarConflito(executor, { refs, proposalId, authorizedEventId, ignorar }) {
  const valores = valoresDeReferencia(refs);
  const filtros = []; const params = [];
  if (valores.length) {
    for (const col of COLUNAS_DE_REFERENCIA) { filtros.push(`LOWER(${col}) IN (${valores.map(() => '?').join(', ')})`); params.push(...valores); }
  }
  if (refs.sourceEventId) { filtros.push('LOWER(source_event_id) = ?'); params.push(norm(refs.sourceEventId)); }
  const consultas = [];
  if (filtros.length) consultas.push(['referencia', `SELECT payment_id FROM gf_lilly_pagamento_refs WHERE ${filtros.join(' OR ')} ORDER BY criado_em, payment_id`, params]);
  if (proposalId) consultas.push(['proposta', 'SELECT payment_id FROM gf_lilly_pagamento_refs WHERE proposal_id = ? ORDER BY criado_em, payment_id', [proposalId]]);
  if (authorizedEventId) consultas.push(['autorizacao', 'SELECT payment_id FROM gf_lilly_pagamento_refs WHERE authorized_event_id = ? ORDER BY criado_em, payment_id', [authorizedEventId]]);
  for (const [tipo, sql, valoresSql] of consultas) {
    const [linhas] = await executor.execute(sql, valoresSql);
    const achado = linhas.find((l) => l.payment_id !== ignorar);
    if (achado) return { tipo, paymentId: achado.payment_id, clientId: await clienteDoPagamento(executor, achado.payment_id) };
  }
  return null;
}

module.exports = { referenciasDe, buscarConflito, valoresDeReferencia };
