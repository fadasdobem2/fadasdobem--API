const chatwootService = require('./chatwoot.service');
const { responderSucesso } = require('../../utils/response.util');
const { catchAsyncRoute } = require('../../utils/catchAsync.util');

/**
 * Receiver HTTP — Chatwoot dispara payloads JSON configurados pelo painel.
 */
module.exports = {
  handleWebhook: catchAsyncRoute(async (req, res) => {
    const result = await chatwootService.processWebhookEnvelope(req.body);
    return responderSucesso(res, result, 'Webhook reconhecido e processado pelo pipeline interno.', 200);
  }),
};
