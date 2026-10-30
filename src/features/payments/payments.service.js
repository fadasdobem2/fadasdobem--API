'use strict';

/**
 * Barrel do serviço de pagamentos. A implementação foi decomposta por
 * responsabilidade para manter cada arquivo pequeno e testável, preservando
 * exatamente a superfície pública consumida por controllers/outros features:
 *
 *  - payments.helpers.js     utils puros (money, uuid, catálogo, log webhook, outbox)
 *  - payments.ledger.js      contas de razão + snapshot + estorno/chargeback
 *  - payments.settlement.js  motor de liquidação (approved/rejected/refund/...) + captura síncrona
 *  - payments.checkout.js    checkout do cliente (PIX/cartão) + aprovação manual
 *  - payments.lead-fsm.js    PIX de lead WhatsApp + reconciliação pós-conversão
 *  - payments.webhook.js     pipeline HTTP do webhook Mercado Pago
 */
const {
  createPixCheckout,
  createCardCheckout,
  approveManualAttendancePayment,
} = require('./payments.checkout');
const { resolvePurchaseInput } = require('./payments.helpers');
const {
  createPixCheckoutForLeadFsm,
  reconcileLeadFsmPaymentsAfterConversion,
} = require('./payments.lead-fsm');
const { processMercadoPagoWebhookAsync } = require('./payments.webhook');

module.exports = {
  createPixCheckout,
  createCardCheckout,
  processMercadoPagoWebhookAsync,
  resolvePurchaseInput,
  approveManualAttendancePayment,
  createPixCheckoutForLeadFsm,
  reconcileLeadFsmPaymentsAfterConversion,
};
