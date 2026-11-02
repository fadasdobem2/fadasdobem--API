'use strict';

/**
 * Semeia a ABERTURA DA PLANILHA (Maturacao/55) direto no banco descartável dos filhos de outras fatias: desde 31/10/2026 o saldo de abertura vem da planilha,
 * não do saldo calculado do legado. `semear(sequelize, { '900013': 5000, '900014': -3000 })` grava um histórico por cliente com corte em 01/01/2000 (todo
 * movimento novo conta), crédito para saldo positivo e débito COBRADO para saldo negativo. Só para teste, SQL direto; a rota real é POST /migration/apply.
 */

const { randomUUID } = require('crypto');

function historico(clientId, centavos) {
  const credito = Math.max(0, centavos); const debito = Math.max(0, -centavos);
  return {
    version: 1, clientId, clientName: `Cliente ${clientId}`, cutoffAt: '2000-01-01T00:00:00', batchId: 'SEMENTE', sourceKey: `${clientId}:SEMENTE`, approvedBy: 'Teste', approvedAt: '2020-01-01T00:00:00.000Z',
    note: 'Semente de teste.', rateCents: 296, importedDebitCents: debito, importedCreditCents: credito, collectDebt: debito > 0, postpaid: false,
    items: debito > 0 ? [{ id: 'I1', date: '01/01/1999', tarot: 'Teste', minutes: 10, valueTodayCents: debito, allocatedCents: debito, partial: false }] : [],
  };
}

async function semear(sequelize, saldos) {
  for (const [clientId, centavos] of Object.entries(saldos)) {
    const h = historico(clientId, Number(centavos));
    await sequelize.query(
      'INSERT INTO gf_migracao_historicos (id, id_cliente, seq, source_key, source_hash, batch_id, corte_em, credito_centavos, debito_centavos, cobrar_debito, pos_pago, aprovado_em, item, criado_por, operation_key) VALUES (:id, :c, 1, :k, :kh, :b, :corte, :cr, :de, :co, false, :ap, :item, :por, :op)',
      { replacements: { id: randomUUID(), c: clientId, k: h.sourceKey, kh: require('crypto').createHash('sha256').update(h.sourceKey).digest('hex'), b: h.batchId, corte: h.cutoffAt, cr: h.importedCreditCents, de: h.importedDebitCents, co: h.collectDebt, ap: h.approvedAt, item: JSON.stringify(h), por: 'Teste', op: `op-semente-${clientId}` } },
    );
  }
}

module.exports = { semear, historico };
