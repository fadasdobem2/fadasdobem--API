'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const AppError = require('../../../utils/AppError');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const {
  listFinanceLedgerTransactions,
  markPayoutAsPaid,
  transitionPayout,
  listPayoutRequests,
  TARGET_BY_ACTION,
  financePulseSummary,
} = require('../services/admin.finance.service');

function httpCtx(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress,
    user_agent: req.headers['user-agent'],
    correlation_id: req.headers['x-request-id'],
  };
}

module.exports = {
  transactions: catchAsyncRoute(async (req, res) => {
    const dados = await listFinanceLedgerTransactions(req.query || {});
    return responderSucesso(res, dados, 'Extrato global Ledger.', 200);
  }),

  markPayoutPaid: catchAsyncRoute(async (req, res) => {
    const dados = await markPayoutAsPaid(req.user.id, req.params.id, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, 'Repasse marcado como PAGO pela Gestora.', 200);
  }),

  listPayouts: catchAsyncRoute(async (req, res) => {
    const dados = await listPayoutRequests(req.query || {});
    return responderSucesso(res, dados, 'Pedidos de repasse.', 200);
  }),

  /** POST /finance/payouts/:id/:action (approve | processing | paid | reject | fail) */
  payoutAction: catchAsyncRoute(async (req, res) => {
    const target = TARGET_BY_ACTION[`${req.params.action || ''}`];
    if (!target) {
      throw new AppError(`Ação de repasse desconhecida. Use: ${Object.keys(TARGET_BY_ACTION).join(', ')}.`, 404, null, true);
    }
    const dados = await transitionPayout(req.user.id, req.params.id, target, req.body || {}, httpCtx(req));
    return responderSucesso(res, dados, `Repasse atualizado para ${target}.`, 200);
  }),

  pulse: catchAsyncRoute(async (_req, res) => {
    const dados = await financePulseSummary();
    return responderSucesso(res, dados, 'Finance pulse (rápido, legado compatível).', 200);
  }),
};
