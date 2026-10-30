'use strict';

const {
  sequelize,
  User,
  AccountRecoveryRequest,
  AccountRecoveryMessage,
} = require('../../../models');
const AppError = require('../../../utils/AppError');
const { persistAdminAuditLog } = require('../helpers/adminAudit.helper');
const { httpCtxNormalize, VALID_STAGES, ALLOWED_TRANSITIONS } = require('./admin.recovery.shared');
const { syncAccounts } = require('./admin.recovery.sync.service');

/**
 * PATCH /admin/recovery/:id/assign
 * Atribui ou remove o admin responsável pela solicitação.
 */
async function assignAdmin(actorId, requestId, body = {}, httpCtx = {}) {
  const id = `${requestId ?? ''}`.trim();
  if (!id) throw new AppError('ID inválido.', 400, null, true);

  const request = await AccountRecoveryRequest.findByPk(id);
  if (!request) throw new AppError('Solicitação não encontrada.', 404, null, true);

  const terminal = ['MERGED', 'REJECTED', 'CANCELLED'];
  if (terminal.includes(request.sync_stage)) {
    throw new AppError('Solicitação já finalizada — não é possível reatribuir.', 409, null, true);
  }

  const newAdminId = `${body.admin_id ?? ''}`.trim() || null;

  if (newAdminId) {
    const admin = await User.findByPk(newAdminId, { attributes: ['id', 'role'] });
    if (!admin || admin.role !== 'GESTORA') {
      throw new AppError('Admin alvo não encontrado ou não tem papel GESTORA.', 404, null, true);
    }
  }

  const oldSnap = { assigned_admin_id: request.assigned_admin_id };

  await sequelize.transaction(async (t) => {
    await request.update({ assigned_admin_id: newAdminId }, { transaction: t });

    await persistAdminAuditLog(
      {
        admin_id: actorId,
        action: 'ADMIN_RECOVERY_ASSIGN',
        target_entity: 'AccountRecoveryRequest',
        target_id: id,
        old_value: oldSnap,
        new_value: { assigned_admin_id: newAdminId },
        httpCtx: httpCtxNormalize(httpCtx),
      },
      { transaction: t }
    );
  });

  await request.reload();
  return { id: request.id, assigned_admin_id: request.assigned_admin_id };
}

/**
 * PATCH /admin/recovery/:id/stage
 * Avança (ou termina) a etapa da solicitação.
 * Se stage = MERGED, executa o sync completo automaticamente.
 */
async function updateStage(actorId, requestId, body = {}, httpCtx = {}) {
  const id = `${requestId ?? ''}`.trim();
  if (!id) throw new AppError('ID inválido.', 400, null, true);

  const newStage = `${body.sync_stage ?? body.stage ?? ''}`.trim().toUpperCase();
  if (!newStage || !VALID_STAGES.includes(newStage)) {
    throw new AppError(`sync_stage inválido. Valores aceitos: ${VALID_STAGES.join(', ')}.`, 400, null, true);
  }

  const request = await AccountRecoveryRequest.findByPk(id);
  if (!request) throw new AppError('Solicitação não encontrada.', 404, null, true);

  const allowed = ALLOWED_TRANSITIONS[request.sync_stage] ?? [];
  if (!allowed.includes(newStage)) {
    throw new AppError(
      `Transição de ${request.sync_stage} → ${newStage} não é permitida.`,
      409,
      null,
      true
    );
  }

  // Se o admin quer ir para MERGING, exige original_user_id preenchido
  if (newStage === 'MERGING' && !request.original_user_id) {
    throw new AppError(
      'Defina original_user_id antes de iniciar o merge (use PATCH /admin/recovery/:id/original-user).',
      409,
      null,
      true
    );
  }

  // Se MERGED, executa o sync completo
  if (newStage === 'MERGED') {
    return syncAccounts(actorId, requestId, body, httpCtx);
  }

  const oldStage = request.sync_stage;
  const notes = `${body.admin_notes ?? body.notes ?? ''}`.trim() || null;
  const rejectionReason = `${body.rejection_reason ?? ''}`.trim().slice(0, 512) || null;

  await sequelize.transaction(async (t) => {
    await request.update(
      {
        sync_stage: newStage,
        stage_updated_at: new Date(),
        ...(notes ? { admin_notes: notes } : {}),
        ...(rejectionReason ? { rejection_reason: rejectionReason } : {}),
        ...(newStage === 'CANCELLED' ? { cancelled_at: new Date() } : {}),
      },
      { transaction: t }
    );

    // Mensagem automática de sistema para o usuário
    const SYSTEM_MESSAGES = {
      IDENTITY_CHECK: 'Sua solicitação está sendo analisada. Nossa equipe está verificando sua identidade.',
      MERGING: 'Identificamos sua conta original. A sincronização foi iniciada.',
      REJECTED: `Sua solicitação foi negada.${rejectionReason ? ` Motivo: ${rejectionReason}` : ''}`,
      CANCELLED: 'Sua solicitação foi cancelada.',
    };

    if (SYSTEM_MESSAGES[newStage]) {
      await AccountRecoveryMessage.create(
        {
          request_id: id,
          sender_user_id: null,
          sender_role: 'SYSTEM',
          body: SYSTEM_MESSAGES[newStage],
        },
        { transaction: t }
      );
    }

    await persistAdminAuditLog(
      {
        admin_id: actorId,
        action: 'ADMIN_RECOVERY_STAGE_UPDATE',
        target_entity: 'AccountRecoveryRequest',
        target_id: id,
        old_value: { sync_stage: oldStage },
        new_value: { sync_stage: newStage, rejection_reason: rejectionReason },
        httpCtx: httpCtxNormalize(httpCtx),
      },
      { transaction: t }
    );
  });

  await request.reload();
  return { id: request.id, sync_stage: request.sync_stage, stage_updated_at: request.stage_updated_at };
}

/**
 * PATCH /admin/recovery/:id/original-user
 * Define qual é o usuário original (conta antiga) que será mesclada.
 */
async function setOriginalUser(actorId, requestId, body = {}, httpCtx = {}) {
  const id = `${requestId ?? ''}`.trim();
  if (!id) throw new AppError('ID inválido.', 400, null, true);

  const originalUserId = `${body.original_user_id ?? ''}`.trim();
  if (!originalUserId) throw new AppError('Informe original_user_id.', 400, null, true);

  const request = await AccountRecoveryRequest.findByPk(id);
  if (!request) throw new AppError('Solicitação não encontrada.', 404, null, true);

  const terminal = ['MERGED', 'REJECTED', 'CANCELLED'];
  if (terminal.includes(request.sync_stage)) {
    throw new AppError('Solicitação já finalizada.', 409, null, true);
  }

  if (originalUserId === request.temp_account_id) {
    throw new AppError('original_user_id não pode ser o mesmo que a conta temporária.', 400, null, true);
  }

  const originalUser = await User.findByPk(originalUserId, {
    attributes: ['id', 'email', 'role', 'deleted_at'],
    paranoid: false,
  });
  if (!originalUser) throw new AppError('Usuário original não encontrado.', 404, null, true);

  const oldSnap = { original_user_id: request.original_user_id };

  await sequelize.transaction(async (t) => {
    await request.update({ original_user_id: originalUserId }, { transaction: t });

    await persistAdminAuditLog(
      {
        admin_id: actorId,
        action: 'ADMIN_RECOVERY_SET_ORIGINAL_USER',
        target_entity: 'AccountRecoveryRequest',
        target_id: id,
        old_value: oldSnap,
        new_value: { original_user_id: originalUserId },
        httpCtx: httpCtxNormalize(httpCtx),
      },
      { transaction: t }
    );
  });

  await request.reload();
  return {
    id: request.id,
    original_user_id: request.original_user_id,
    original_user_email: originalUser.email,
  };
}

/**
 * POST /admin/recovery/:id/notes
 * Atualiza as notas internas do admin sobre a solicitação.
 */
async function updateNotes(actorId, requestId, body = {}, httpCtx = {}) {
  const id = `${requestId ?? ''}`.trim();
  if (!id) throw new AppError('ID inválido.', 400, null, true);

  const request = await AccountRecoveryRequest.findByPk(id);
  if (!request) throw new AppError('Solicitação não encontrada.', 404, null, true);

  const notes = `${body.admin_notes ?? body.notes ?? ''}`.trim();

  await sequelize.transaction(async (t) => {
    await request.update({ admin_notes: notes || null }, { transaction: t });

    await persistAdminAuditLog(
      {
        admin_id: actorId,
        action: 'ADMIN_RECOVERY_NOTES_UPDATE',
        target_entity: 'AccountRecoveryRequest',
        target_id: id,
        old_value: { admin_notes: request.admin_notes },
        new_value: { admin_notes: notes || null },
        httpCtx: httpCtxNormalize(httpCtx),
      },
      { transaction: t }
    );
  });

  return { id: request.id, admin_notes: notes || null };
}

module.exports = { assignAdmin, updateStage, setOriginalUser, updateNotes };
