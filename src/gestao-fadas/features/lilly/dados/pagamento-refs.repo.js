'use strict';

/** `gf_lilly_pagamento_refs`: referências do provedor por pagamento lançado (duplicidade por referência, R3). Único por `payment_id`. */

const { iso } = require('./executor');
const { AcaoRecusadaError } = require('../acoes/acoes.erros');

const COLUNAS = 'payment_id, reference, mp_payment_id, external_transaction_id, end_to_end_id, source_event_id, proposal_id, authorized_event_id, provider_confirmed, authorized_by, criado_em';
const CAMPOS_DE_BUSCA = {
  reference: 'reference', mpPaymentId: 'mp_payment_id', externalTransactionId: 'external_transaction_id', endToEndId: 'end_to_end_id', sourceEventId: 'source_event_id',
};

const paraObjeto = (l) => l && ({
  paymentId: l.payment_id,
  reference: l.reference,
  mpPaymentId: l.mp_payment_id,
  externalTransactionId: l.external_transaction_id,
  endToEndId: l.end_to_end_id,
  sourceEventId: l.source_event_id,
  proposalId: l.proposal_id,
  authorizedEventId: l.authorized_event_id,
  providerConfirmed: l.provider_confirmed === true,
  authorizedBy: l.authorized_by || undefined,
  criadoEm: iso(l.criado_em),
});

/**
 * Idempotente por `paymentId`. Devolve `{ ref, repetida }`. O banco também barra, SEM caixa e em qualquer cadastro, a repetição de `reference`,
 * `mp_payment_id` e `end_to_end_id` (índices únicos): como `INSERT IGNORE` vira `ON CONFLICT DO NOTHING`, que engoliria essa violação, a linha
 * que não ficou gravada é tratada como conflito de unicidade, nunca como sucesso.
 */
async function gravarRefs(executor, r) {
  const [res] = await executor.execute(
    `INSERT IGNORE INTO gf_lilly_pagamento_refs (payment_id, reference, mp_payment_id, external_transaction_id, end_to_end_id, source_event_id, proposal_id, authorized_event_id, provider_confirmed, authorized_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [r.paymentId, r.reference ?? null, r.mpPaymentId ?? null, r.externalTransactionId ?? null, r.endToEndId ?? null, r.sourceEventId ?? null, r.proposalId ?? null, r.authorizedEventId ?? null, r.providerConfirmed === true, r.authorizedBy ?? null],
  );
  const ref = await buscarPorPagamento(executor, r.paymentId);
  if (!ref) throw new AcaoRecusadaError('LILLY_PAYMENT_ALREADY_RECORDED', 'Este pagamento já foi lançado (a referência do provedor é única em todos os cadastros).', 409);
  return { ref, repetida: res.affectedRows === 0 };
}

async function buscarPorPagamento(executor, paymentId) {
  const [linhas] = await executor.execute(`SELECT ${COLUNAS} FROM gf_lilly_pagamento_refs WHERE payment_id = ?`, [paymentId]);
  return paraObjeto(linhas[0]) || null;
}

/** Pagamentos que já usam alguma das referências informadas (reference, mpPaymentId, externalTransactionId, endToEndId, sourceEventId). */
async function buscarPorReferencias(executor, referencias) {
  const filtros = Object.entries(CAMPOS_DE_BUSCA).filter(([chave]) => referencias[chave]);
  if (!filtros.length) return [];
  const [linhas] = await executor.execute(
    `SELECT ${COLUNAS} FROM gf_lilly_pagamento_refs WHERE ${filtros.map(([, col]) => `${col} = ?`).join(' OR ')} ORDER BY criado_em, payment_id`,
    filtros.map(([chave]) => `${referencias[chave]}`),
  );
  return linhas.map(paraObjeto);
}

module.exports = { gravarRefs, buscarPorPagamento, buscarPorReferencias };
