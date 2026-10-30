'use strict';

/**
 * Estorno (total/parcial) e chargeback do crédito de uma ordem (F-04), tudo em centavos inteiros.
 *
 * Para cada evento calcula o alvo ACUMULADO a reverter (total do crédito, ou a proporção de
 * `transaction_amount_refunded` no estorno parcial) e subtrai o que o razão já tratou para a ordem
 * (soma dos lançamentos REFUND/CHARGEBACK com `reference_id = ordem`). A diferença (delta) é:
 *   - REVERTIDA do saldo ainda não consumido do lote (carteira ou pacote do próprio cliente), e
 *   - o que não dá para reverter (já consumido) vira PERDA registrada: débito em PLATFORM_REVENUE.
 * Chaves idempotentes por (pagamento MP, alvo acumulado): webhook repetido não lança de novo e um
 * segundo estorno parcial lança só a diferença.
 *
 * Consumo por lote: o PACOTE usa `remaining_amount` (mantido por sessions). O AVULSO não tem consumo
 * por lote em sessions (só debita a carteira), então o consumido é inferido como
 * max(0, soma dos lotes avulsos - saldo da carteira), atribuído FIFO (lote mais antigo primeiro).
 * Pendência: clawback da comissão já paga à taróloga sobre o consumo estornado (decisão da Nice).
 */
const { ClientCreditLot } = require('../../models');
const { sequelize } = require('../../config/database');
const { toCents, centsToString, mulDivRound } = require('./payments.money');
const { postEntry, readBalanceCents } = require('./payments.posting');
const {
  ensurePlatformSuspense,
  ensureChargebackReserve,
  ensurePlatformRevenue,
  ensureClientWallet,
  ensureClientPacoteEscrow,
} = require('./payments.ledger');

async function handledCents(orderId, t) {
  const rows = await sequelize.query(
    `SELECT COALESCE(SUM(amount), 0)::text AS s FROM transaction_ledger
      WHERE reference_id = :oid AND reference_type IN ('REFUND', 'CHARGEBACK')`,
    { replacements: { oid: orderId }, transaction: t, type: sequelize.QueryTypes.SELECT }
  );
  return toCents(rows[0]?.s) ?? 0;
}

function refundedGrossCents(mp) {
  const direct = toCents(mp.transaction_amount_refunded);
  if (direct != null && direct > 0) return direct;
  if (Array.isArray(mp.refunds)) {
    const s = mp.refunds.reduce((acc, r) => acc + (toCents(r?.amount) ?? 0), 0);
    if (s > 0) return s;
  }
  return null;
}

/** Quanto de cada lote avulso do cliente ainda é saldo (FIFO: o consumo recai nos mais antigos). */
function fifoUnconsumed(avulsoLots, walletCents) {
  const caps = avulsoLots.map((l) => Math.max(0, toCents(l.remaining_amount) ?? 0));
  let consumed = Math.max(0, caps.reduce((a, b) => a + b, 0) - walletCents);
  const out = new Map();
  avulsoLots.forEach((l, i) => {
    const eat = Math.min(consumed, caps[i]);
    consumed -= eat;
    out.set(l.id, caps[i] - eat);
  });
  return out;
}

/**
 * @param {import('sequelize').Model} order ordem já travada (FOR UPDATE) pelo chamador
 * @param {'REFUND'|'CHARGEBACK'} kind
 * @returns {Promise<{ reversedCents: number, lossCents: number }>}
 */
async function reverseOrderCredit(order, mp, kind, t) {
  const none = { reversedCents: 0, lossCents: 0 };
  if (!order.client_id) {
    console.warn('[Payments] estorno omitido: pedido sem client_id (FSM Lead ainda não convertido).');
    return none;
  }

  const lots = await ClientCreditLot.findAll({
    where: { payment_order_id: order.id },
    order: [['created_at', 'ASC'], ['id', 'ASC']],
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (!lots.length) return none;

  const creditedCents = lots.reduce((a, l) => a + (toCents(l.initial_amount) ?? 0), 0);
  if (creditedCents <= 0) return none;

  const full = kind === 'CHARGEBACK' || `${mp.status}` === 'refunded';
  let target = creditedCents;
  if (!full) {
    const refundedGross = refundedGrossCents(mp);
    const gross = toCents(mp.transaction_amount) ?? toCents(order.mp_transaction_amount) ?? toCents(order.amount);
    if (refundedGross == null || !gross || gross <= 0) {
      console.warn('[Payments] estorno parcial sem transaction_amount_refunded: nada a reverter', { mp: mp.id });
      return none;
    }
    target = Math.min(creditedCents, mulDivRound(creditedCents, Math.min(refundedGross, gross), gross));
  }

  const delta = target - (await handledCents(order.id, t));
  if (delta <= 0) return none;

  const reserve = kind === 'CHARGEBACK' ? await ensureChargebackReserve(t) : await ensurePlatformSuspense(t);
  const revenue = await ensurePlatformRevenue(t);

  const accByType = {};
  const balByAcc = new Map();
  for (const lot of lots) {
    const type = `${lot.credit_type}`;
    if (!accByType[type]) {
      accByType[type] =
        type === 'PACOTE_SESSAO_UNICA'
          ? await ensureClientPacoteEscrow(order.client_id, t)
          : await ensureClientWallet(order.client_id, t);
      balByAcc.set(accByType[type].id, await readBalanceCents(accByType[type].id, t));
    }
  }

  let unconsumed = new Map();
  if (accByType.AVULSO) {
    const avulsoLots = await ClientCreditLot.findAll({
      where: { client_id: order.client_id, credit_type: 'AVULSO', is_locked: false },
      order: [['created_at', 'ASC'], ['id', 'ASC']],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    unconsumed = fifoUnconsumed(avulsoLots, balByAcc.get(accByType.AVULSO.id));
  }

  let left = delta;
  const takes = [];
  for (const lot of lots) {
    const acc = accByType[`${lot.credit_type}`];
    const free =
      lot.credit_type === 'PACOTE_SESSAO_UNICA'
        ? Math.max(0, toCents(lot.remaining_amount) ?? 0)
        : unconsumed.get(lot.id) ?? 0;
    const take = lot.is_locked ? 0 : Math.min(left, free, Math.max(0, balByAcc.get(acc.id)));
    balByAcc.set(acc.id, balByAcc.get(acc.id) - take);
    left -= take;
    takes.push(take);
  }
  const reversedCents = delta - left;
  const lossCents = left;

  const base = `mp-${kind.toLowerCase()}-${mp.id}-${target}`;
  const meta = (part) => ({
    mp_payment_id: String(mp.id),
    mp_status: mp.status,
    mp_status_detail: mp.status_detail || null,
    kind,
    part,
    target_cents: target,
    delta_cents: delta,
  });
  const label = kind === 'CHARGEBACK' ? 'Chargeback' : 'Estorno';

  for (let i = 0; i < lots.length; i += 1) {
    if (takes[i] > 0) {
      await postEntry(t, {
        debitId: accByType[`${lots[i].credit_type}`].id,
        creditId: reserve.id,
        amountCents: takes[i],
        referenceType: kind,
        referenceId: order.id,
        idempotencyKey: `${base}-rev-${i}`,
        description: `${label} MP #${mp.id} (saldo não consumido)`,
        metadata: { ...meta('REVERSAL'), settlement_target: lots[i].credit_type },
      });
    }
  }
  if (lossCents > 0) {
    await postEntry(t, {
      debitId: revenue.id,
      creditId: reserve.id,
      amountCents: lossCents,
      referenceType: kind,
      referenceId: order.id,
      idempotencyKey: `${base}-loss`,
      description: `${label} MP #${mp.id} (parcela já consumida, perda da plataforma)`,
      metadata: meta('LOSS'),
      allowNegativeDebit: true,
    });
  }

  let lossToBook = lossCents;
  for (let i = 0; i < lots.length; i += 1) {
    const lot = lots[i];
    const rem = Math.max(0, toCents(lot.remaining_amount) ?? 0);
    let drop = takes[i];
    if (lot.credit_type !== 'PACOTE_SESSAO_UNICA') {
      const extra = Math.min(lossToBook, Math.max(0, rem - drop));
      drop += extra;
      lossToBook -= extra;
    }
    const closed = full || rem - drop <= 0;
    await lot.update(
      {
        remaining_amount: centsToString(full ? 0 : Math.max(0, rem - drop)),
        ...(closed ? { is_locked: true } : {}),
        notes: `${label} MP ${mp.id}`.slice(0, 500),
      },
      { transaction: t }
    );
  }

  return { reversedCents, lossCents };
}

module.exports = { reverseOrderCredit, fifoUnconsumed };
