'use strict';

const {
  sequelize,
  User,
  Client,
  TemporaryUser,
  TemporaryClient,
  AccountRecoveryRequest,
  AccountRecoveryMessage,
  Session,
  PaymentOrder,
  ClientCreditLot,
  Review,
  ClientDiary,
  Queue,
  LedgerAccount,
  RefreshToken,
} = require('../../../models');
const AppError = require('../../../utils/AppError');
const { persistAdminAuditLog } = require('../helpers/adminAudit.helper');
const { httpCtxNormalize } = require('./admin.recovery.shared');

/**
 * POST /admin/recovery/:id/sync  (ou via updateStage com stage=MERGED)
 *
 * Sincronização completa: transfere todos os dados da conta temporária
 * para a conta original, depois desativa a conta temporária.
 *
 * Fluxo de acesso pós-sync:
 *   1. Email da conta original é trocado pelo email da conta temporária
 *      → usuário loga com o novo email na conta com todo o histórico reunido
 *   2. Email da conta temporária recebe um sufixo de tombstone para liberar o unique
 *   3. Conta temporária é desativada (is_active=false, blocked_at preenchido)
 *   4. Todos os tokens de refresh da temporária são revogados
 *
 * O que é transferido (sem apagar nada da original):
 *   - sessions, payment_orders, client_credit_lots, reviews,
 *     client_diaries, queues, ledger_accounts
 *   - campos do perfil client que estiverem vazios na original recebem
 *     o valor da temporária
 */
async function syncAccounts(actorId, requestId, body = {}, httpCtx = {}) {
  const id = `${requestId ?? ''}`.trim();
  if (!id) throw new AppError('ID inválido.', 400, null, true);

  const request = await AccountRecoveryRequest.findByPk(id);
  if (!request) throw new AppError('Solicitação não encontrada.', 404, null, true);

  if (request.sync_stage === 'MERGED') {
    throw new AppError('Esta solicitação já foi sincronizada.', 409, null, true);
  }

  const blockedStages = ['REJECTED', 'CANCELLED'];
  if (blockedStages.includes(request.sync_stage)) {
    throw new AppError('Não é possível sincronizar uma solicitação rejeitada ou cancelada.', 409, null, true);
  }

  if (!request.original_user_id) {
    throw new AppError(
      'Defina a conta original antes de sincronizar (use PATCH /admin/recovery/:id/original-user).',
      409,
      null,
      true
    );
  }

  if (request.temp_account_id === request.original_user_id) {
    throw new AppError('Conta temporária e original não podem ser o mesmo usuário.', 400, null, true);
  }

  const syncResult = await sequelize.transaction(async (t) => {
    // Pessimistic locks para evitar race conditions
    const tempUser = await TemporaryUser.findByPk(request.temp_account_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
      paranoid: false,
    });
    const originalUser = await User.findByPk(request.original_user_id, {
      transaction: t,
      lock: t.LOCK.UPDATE,
      paranoid: false,
    });

    if (!tempUser) throw new AppError('Conta temporária não encontrada.', 404, null, true);
    if (!originalUser) throw new AppError('Conta original não encontrada.', 404, null, true);

    const tempClient = await TemporaryClient.findOne({
      where: { temp_user_id: tempUser.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
      paranoid: false,
    });
    const originalClient = await Client.findOne({
      where: { user_id: originalUser.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
      paranoid: false,
    });

    if (!tempClient) throw new AppError('Perfil de cliente (temporário) não encontrado.', 404, null, true);
    if (!originalClient) throw new AppError('Perfil de cliente (original) não encontrado.', 404, null, true);

    // Snapshots para auditoria (antes de qualquer alteração)
    const snapTempUser = { id: tempUser.id, email: tempUser.email, is_active: tempUser.is_active };
    const snapOriginalUser = { id: originalUser.id, email: originalUser.email };
    const snapOriginalClient = {
      nome_completo: originalClient.nome_completo,
      apelido: originalClient.apelido,
      data_nascimento: originalClient.data_nascimento,
    };

    const stats = {
      sessions_transferred: 0,
      payment_orders_transferred: 0,
      credit_lots_transferred: 0,
      reviews_transferred: 0,
      diaries_transferred: 0,
      queues_transferred: 0,
      ledger_accounts_transferred: 0,
    };

    // ─── 1. Transferências: temp_client_id → client_id (conta original) ──────
    // Os registros da conta temporária foram gravados em `temp_client_id`.
    // Ao sincronizar, movemos tudo para `client_id` da conta original e
    // zeramos `temp_client_id` para manter integridade referencial.

    const transferFields = { client_id: originalClient.id, temp_client_id: null };
    const tempWhere = { temp_client_id: tempClient.id };

    const [s] = await Session.update(transferFields, { where: tempWhere, transaction: t });
    stats.sessions_transferred = s;

    const [po] = await PaymentOrder.update(transferFields, { where: tempWhere, transaction: t });
    stats.payment_orders_transferred = po;

    const [ccl] = await ClientCreditLot.update(transferFields, { where: tempWhere, transaction: t });
    stats.credit_lots_transferred = ccl;

    const [rv] = await Review.update(transferFields, { where: tempWhere, transaction: t });
    stats.reviews_transferred = rv;

    const [cd] = await ClientDiary.update(transferFields, { where: tempWhere, transaction: t });
    stats.diaries_transferred = cd;

    const [q] = await Queue.update(transferFields, { where: tempWhere, transaction: t });
    stats.queues_transferred = q;

    const [la] = await LedgerAccount.update(transferFields, { where: tempWhere, transaction: t });
    stats.ledger_accounts_transferred = la;

    // ─── 2. Enriquecimento do perfil original (só preenche o que está vazio) ─

    const clientUpdates = {};
    if (!originalClient.nome_completo && tempClient.nome_completo) {
      clientUpdates.nome_completo = tempClient.nome_completo;
    }
    if (!originalClient.nome && tempClient.nome) {
      clientUpdates.nome = tempClient.nome;
    }
    if (!originalClient.apelido && tempClient.apelido) {
      clientUpdates.apelido = tempClient.apelido;
    }
    if (!originalClient.data_nascimento && tempClient.data_nascimento) {
      clientUpdates.data_nascimento = tempClient.data_nascimento;
    }
    if (Object.keys(clientUpdates).length > 0) {
      await originalClient.update(clientUpdates, { transaction: t });
    }

    // ─── 3. Troca de email: original recebe o email da temporária ──────────
    //
    // Isso é o que permite o usuário retomar o acesso com o novo email.
    // Sequência obrigatória para não violar o unique constraint em users.email:
    //   a) tombstone na temporária  (libera o email para a original)
    //   b) original recebe o email da temporária
    //   c) temporária fica com email tombstone definitivo

    const newEmailForOriginal = tempUser.email;
    const tombstoneEmail = `_merged_${id}_${tempUser.email}`.slice(0, 319);

    // a) Temporária: troca para tombstone (libera o email)
    await tempUser.update(
      { email: tombstoneEmail },
      { transaction: t }
    );

    // b) Original: recebe o novo email (o que o usuário vai usar para logar)
    await originalUser.update(
      { email: newEmailForOriginal },
      { transaction: t }
    );

    // ─── 4. Desativar conta temporária ─────────────────────────────────────

    await tempUser.update(
      {
        is_active: false,
        blocked_at: new Date(),
        block_reason: `Conta temporária sincronizada com user ${originalUser.id} via AccountRecoveryRequest ${id}`,
      },
      { transaction: t }
    );

    // ─── 5. Revogar todos os tokens de refresh da temporária ───────────────

    await RefreshToken.update(
      { revoked_at: new Date() },
      {
        where: { temp_user_id: tempUser.id, revoked_at: null },
        transaction: t,
      }
    );

    // ─── 6. Finaliza a solicitação ─────────────────────────────────────────

    await request.update(
      {
        sync_stage: 'MERGED',
        stage_updated_at: new Date(),
        merged_at: new Date(),
        ...(body.admin_notes ? { admin_notes: `${body.admin_notes}`.trim() } : {}),
      },
      { transaction: t }
    );

    // Mensagem de sistema para o usuário (visível no /account-recovery/status)
    await AccountRecoveryMessage.create(
      {
        request_id: id,
        sender_user_id: null,
        sender_role: 'SYSTEM',
        body: `Sua conta foi sincronizada com sucesso! Seu histórico, créditos e vínculos foram reunidos na sua conta original. Agora você pode entrar normalmente com o e-mail: ${newEmailForOriginal}`,
      },
      { transaction: t }
    );

    // ─── 7. Auditoria completa ─────────────────────────────────────────────

    await persistAdminAuditLog(
      {
        admin_id: actorId,
        action: 'ADMIN_RECOVERY_SYNC_EXECUTED',
        target_entity: 'AccountRecoveryRequest',
        target_id: id,
        old_value: {
          sync_stage: request.sync_stage,
          temp_user: snapTempUser,
          original_user: snapOriginalUser,
          original_client: snapOriginalClient,
        },
        new_value: {
          sync_stage: 'MERGED',
          merged_at: new Date(),
          original_user_new_email: newEmailForOriginal,
          temp_user_tombstone_email: tombstoneEmail,
          client_fields_enriched: clientUpdates,
          stats,
        },
        httpCtx: httpCtxNormalize(httpCtx),
      },
      { transaction: t }
    );

    return {
      stats,
      new_email_for_original: newEmailForOriginal,
      original_user_id: originalUser.id,
      temp_user_id: tempUser.id,
    };
  });

  await request.reload();

  return {
    id: request.id,
    sync_stage: request.sync_stage,
    merged_at: request.merged_at,
    original_user_id: request.original_user_id,
    temp_account_id: request.temp_account_id,
    new_email_for_original: syncResult.new_email_for_original,
    transfer_stats: syncResult.stats,
  };
}

module.exports = { syncAccounts };
