'use strict';

/**
 * Utilitários puros de pagamentos: arredondamento monetário, normalização de
 * UUID, parsing do catálogo/compra, logging seguro de webhook e enfileiramento
 * de entregas (outbox). Sem efeitos colaterais de negócio além do enqueue.
 */
const { ClientCreditLot } = require('../../models');
const AppError = require('../../utils/AppError');
const { enqueuePendingDeliveryJob } = require('../../queues/delivery.queue');
const { loadPackageCatalog } = require('./payments.constants');
const { toCents, centsToNumber, roundMoney } = require('./payments.money');

function cloneJson(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return null;
  }
}

function redactWebhookHeaders(h) {
  const out = { ...h };
  if (out['x-signature']) out['x-signature'] = '[redacted]';
  return out;
}

function isMercadoPagoProductionEnv() {
  return `${process.env.MP_ENV || 'sandbox'}`.trim().toLowerCase() === 'production';
}

/** Bloqueia notificações de teste (`live_mode: false`) quando a API está em modo produção. */
function assertNoTestNotificationInProduction(body, mpPayment) {
  if (!isMercadoPagoProductionEnv()) return true;
  const candidates = [body?.live_mode, mpPayment?.live_mode];
  for (const lm of candidates) {
    if (lm === false || lm === 'false' || lm === 0 || lm === '0') {
      console.error(
        '[Security] Tentativa de injetar pagamento de Teste em ambiente de Produção bloqueada.'
      );
      return false;
    }
  }
  return true;
}

/** Logs detalhados do webhook (`MP_WEBHOOK_VERBOSE=false` para silenciar JSON completo). */
function isMpWebhookVerbose() {
  const v = process.env.MP_WEBHOOK_VERBOSE;
  if (v === undefined || String(v).trim() === '') return true;
  return ['true', '1', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

function safeJsonForLog(obj, maxChars) {
  const max = typeof maxChars === 'number' && maxChars > 0 ? maxChars : 32000;
  try {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    if (s.length <= max) return s;
    return `${s.slice(0, max)}\n… [{MP:Webhook} truncado - total ${s.length} chars]`;
  } catch (e) {
    return `[MP:Webhook] não serializável: ${e?.message || e}`;
  }
}

function appendWebhookVault(existing, entry) {
  const row = {
    received_at: new Date().toISOString(),
    ...entry,
  };
  if (existing == null) return [row];
  if (Array.isArray(existing)) return [...existing, row];
  return [existing, row];
}

/** UUID lowercase canónico ou `null` se inválido. */
function normalizeUuidCandidate(raw) {
  const s = `${raw || ''}`.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s) ? s : null;
}

async function enqueuePendingDeliveriesAfterCommit(ids = []) {
  const seen = [...new Set((ids || []).map((x) => `${x || ''}`.trim()).filter(Boolean))];
  for (const id of seen) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await enqueuePendingDeliveryJob(id);
    } catch (e) {
      console.error('[payments:outbox_enqueue] falha BullMQ:', id, e?.message || e);
    }
  }
}

function validateCreditType(ct) {
  const allowed = ClientCreditLot.CREDIT_TYPES || ['AVULSO', 'PACOTE_SESSAO_UNICA'];
  if (!allowed.includes(ct)) {
    throw new AppError(`credit_type inválido. Use: ${allowed.join(', ')}.`, 400, null, true);
  }
  return ct;
}

/**
 * Valor a creditar ao cliente, em CENTAVOS. Regra atual mantida (F-06, decisão da Nice pendente):
 * credita o LÍQUIDO do MP (`net_received_amount`). Líquido ausente, zero ou negativo cai para o BRUTO
 * (`transaction_amount`, depois `order.amount`), então `net = 0` nunca vira erro em loop. Líquido acima
 * do bruto é limitado ao bruto. Devolve null só se nenhum valor positivo existir.
 */
function pickCreditCentsFromMp(order, mp) {
  const gross = toCents(mp?.transaction_amount) ?? toCents(order?.amount);
  const net = toCents(mp?.transaction_details?.net_received_amount);
  if (net != null && net > 0) return gross != null && gross > 0 && net > gross ? gross : net;
  return gross != null && gross > 0 ? gross : null;
}

/** Igual a `pickCreditCentsFromMp`, em reais (Number com 2 casas) ou null. */
function pickCreditBrlFromMp(order, mp) {
  const c = pickCreditCentsFromMp(order, mp);
  return c == null ? null : centsToNumber(c);
}

function mapPaymentMethod(mp) {
  const tid = `${mp?.payment_type_id || ''}`.toLowerCase();
  if (tid.includes('credit')) return 'CREDIT_CARD';
  if (tid.includes('debit')) return 'DEBIT_CARD';
  if (tid.includes('bank') || `${mp?.payment_method_id || ''}`.toLowerCase() === 'pix') return 'PIX';
  if (tid.includes('account_money')) return 'WALLET_MP';
  return 'UNKNOWN';
}

function resolveNotificationUrl() {
  const explicit = `${process.env.MP_NOTIFICATION_URL || ''}`.trim();
  if (explicit) return explicit;
  const base = `${process.env.API_PUBLIC_URL || ''}`.trim().replace(/\/+$/, '');
  if (!base) return undefined;
  return `${base}/api/v1/payments/webhook`;
}

function resolvePurchaseInput(body = {}) {
  const catalog = loadPackageCatalog();
  const packageId = body.package_id != null ? String(body.package_id).trim() : '';
  const amountRaw = body.amount;

  if (amountRaw != null && amountRaw !== '') {
    const amt = roundMoney(amountRaw);
    if (!amt) {
      throw new AppError('amount inválido - informe um valor positivo em BRL.', 400, null, true);
    }
    return {
      amount_brl: amt,
      credit_type: validateCreditType(`${body.credit_type || 'AVULSO'}`.trim().toUpperCase()),
      label: body.label || 'Recarga avulsa',
      package_id: null,
    };
  }

  if (!packageId) {
    throw new AppError('Informe `package_id` ou `amount` (BRL).', 400, null, true);
  }

  const pkg = catalog[packageId];
  if (!pkg || typeof pkg !== 'object') {
    throw new AppError(`Pacote desconhecido: "${packageId}".`, 400, null, true);
  }
  const amt = roundMoney(pkg.amount_brl);
  if (!amt) {
    throw new AppError(`Pacote "${packageId}" sem amount_brl válido.`, 500, null, true);
  }
  return {
    amount_brl: amt,
    credit_type: validateCreditType(
      `${pkg.credit_type || 'PACOTE_SESSAO_UNICA'}`.trim().toUpperCase()
    ),
    label: pkg.label || packageId,
    package_id: packageId,
  };
}

module.exports = {
  cloneJson,
  redactWebhookHeaders,
  isMercadoPagoProductionEnv,
  assertNoTestNotificationInProduction,
  isMpWebhookVerbose,
  safeJsonForLog,
  appendWebhookVault,
  roundMoney,
  normalizeUuidCandidate,
  enqueuePendingDeliveriesAfterCommit,
  validateCreditType,
  pickCreditBrlFromMp,
  pickCreditCentsFromMp,
  mapPaymentMethod,
  resolveNotificationUrl,
  resolvePurchaseInput,
};
