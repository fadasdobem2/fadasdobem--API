'use strict';

/**
 * Contas de razão dos pagamentos (suspense, reserva de chargeback, receita da plataforma,
 * carteira e pacote do cliente) e snapshot do Mercado Pago no pedido. As contas são criadas por
 * `ensureLedgerAccount` (ON CONFLICT + trava) e a escrita no razão é só por `postEntry`.
 * Estorno/chargeback ficam em `payments.reversal.js`.
 */
const { ensureLedgerAccount } = require('./payments.posting');
const { toCents, centsToString } = require('./payments.money');

const ensurePlatformSuspense = (t) =>
  ensureLedgerAccount({ accountType: 'PLATFORM_SUSPENSE', label: 'Suspense - liquidação gateways' }, t);

const ensureChargebackReserve = (t) =>
  ensureLedgerAccount({ accountType: 'CHARGEBACK_RESERVE', label: 'Reserva chargeback / disputas' }, t);

const ensurePlatformRevenue = (t) =>
  ensureLedgerAccount({ accountType: 'PLATFORM_REVENUE', label: 'Receita da plataforma' }, t);

const ensureClientWallet = (clientId, t) =>
  ensureLedgerAccount({ accountType: 'CLIENT_WALLET', clientId, label: 'Carteira', initialCents: 0 }, t);

const ensureClientPacoteEscrow = (clientId, t) =>
  ensureLedgerAccount(
    { accountType: 'CLIENT_PACOTE_ESCROW', clientId, label: 'Pré‑pago - pacote sessão única', initialCents: 0 },
    t
  );

/** Grava no pedido o retrato do pagamento MP (valores em centavos exatos, taxa = bruto - líquido). */
async function applyMpSnapshotToOrder(order, mp, t) {
  const gross = toCents(mp.transaction_amount);
  const net = toCents(mp.transaction_details?.net_received_amount);
  const fee = gross != null && net != null ? Math.max(0, gross - net) : null;

  const patch = {
    mp_payment_id: String(mp.id),
    mp_merchant_order_id: mp.order?.id != null ? String(mp.order.id) : order.mp_merchant_order_id,
    mp_status: mp.status,
    mp_status_detail: mp.status_detail || null,
    mp_payment_method_id: mp.payment_method_id || null,
    mp_payment_type_id: mp.payment_type_id || null,
    mp_transaction_amount: gross != null ? centsToString(gross) : order.mp_transaction_amount,
    mp_net_received_amount: net != null ? centsToString(net) : order.mp_net_received_amount,
    mp_fee_amount: fee != null ? centsToString(fee) : order.mp_fee_amount,
  };

  if (mp.point_of_interaction?.transaction_data?.qr_code) {
    patch.pix_qr_code = mp.point_of_interaction.transaction_data.qr_code;
  }
  if (mp.point_of_interaction?.transaction_data?.qr_code_base64) {
    patch.pix_qr_code_base64 = mp.point_of_interaction.transaction_data.qr_code_base64;
  }
  const exp = mp.date_of_expiration;
  if (exp) {
    const d = new Date(exp);
    if (Number.isFinite(d.getTime())) patch.pix_expires_at = d;
  }

  await order.update(patch, { transaction: t });
}

module.exports = {
  ensurePlatformSuspense,
  ensureChargebackReserve,
  ensurePlatformRevenue,
  ensureClientWallet,
  ensureClientPacoteEscrow,
  applyMpSnapshotToOrder,
};
