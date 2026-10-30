'use strict';

const { AccountRecoveryRequest, AccountRecoveryMessage } = require('../../../models');
const AppError = require('../../../utils/AppError');
const { persistAdminAuditLog } = require('../helpers/adminAudit.helper');
const { httpCtxNormalize } = require('./admin.recovery.shared');

/**
 * POST /admin/recovery/:id/admin-message
 * Admin envia mensagem para o usuário dentro da solicitação.
 */
async function sendAdminMessage(actorId, requestId, body = {}, httpCtx = {}) {
  const id = `${requestId ?? ''}`.trim();
  if (!id) throw new AppError('ID inválido.', 400, null, true);

  const text = `${body.mensagem ?? body.message ?? body.body ?? ''}`.trim();
  if (!text) throw new AppError('O corpo da mensagem não pode estar vazio.', 400, null, true);
  if (text.length > 2000) throw new AppError('Mensagem muito longa (máx. 2000 caracteres).', 400, null, true);

  const request = await AccountRecoveryRequest.findByPk(id);
  if (!request) throw new AppError('Solicitação não encontrada.', 404, null, true);

  const terminal = ['MERGED', 'REJECTED', 'CANCELLED'];
  if (terminal.includes(request.sync_stage)) {
    throw new AppError('Solicitação já finalizada — não é possível enviar mensagens.', 409, null, true);
  }

  const message = await AccountRecoveryMessage.create({
    request_id: id,
    sender_user_id: actorId,
    sender_role: 'ADMIN',
    body: text,
    read_at: null,
  });

  await persistAdminAuditLog({
    admin_id: actorId,
    action: 'ADMIN_RECOVERY_MESSAGE_SENT',
    target_entity: 'AccountRecoveryRequest',
    target_id: id,
    metadata: { message_id: message.id },
    httpCtx: httpCtxNormalize(httpCtx),
  });

  return {
    id: message.id,
    sender_role: message.sender_role,
    body: message.body,
    created_at: message.created_at,
  };
}

/**
 * POST /admin/recovery/:id/mark-messages-read
 * Admin marca mensagens do usuário como lidas.
 */
async function markMessagesRead(actorId, requestId) {
  const id = `${requestId ?? ''}`.trim();
  if (!id) throw new AppError('ID inválido.', 400, null, true);

  const request = await AccountRecoveryRequest.findByPk(id);
  if (!request) throw new AppError('Solicitação não encontrada.', 404, null, true);

  const [affected] = await AccountRecoveryMessage.update(
    { read_at: new Date() },
    {
      where: {
        request_id: id,
        sender_role: 'USER',
        read_at: null,
        deleted_at: null,
      },
    }
  );

  return { marked_read: affected };
}

module.exports = { sendAdminMessage, markMessagesRead };
