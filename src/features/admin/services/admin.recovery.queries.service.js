'use strict';

const { QueryTypes } = require('sequelize');
const {
  sequelize,
  User,
  TemporaryUser,
  AccountRecoveryRequest,
  AccountRecoveryMessage,
} = require('../../../models');
const AppError = require('../../../utils/AppError');
const { VALID_STAGES } = require('./admin.recovery.shared');

/**
 * GET /admin/recovery/list
 * Lista solicitações com filtros opcionais por stage, admin atribuído e paginação.
 */
async function listRecoveryRequests(query = {}) {
  const stage = `${query.stage ?? ''}`.trim().toUpperCase();
  const assignedAdminId = `${query.assigned_admin_id ?? ''}`.trim();

  let limit = parseInt(`${query.limit ?? 40}`, 10);
  if (!Number.isFinite(limit)) limit = 40;
  limit = Math.min(Math.max(limit, 1), 100);

  let offset = parseInt(`${query.offset ?? 0}`, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const where = { deleted_at: null };
  if (stage && VALID_STAGES.includes(stage)) where.sync_stage = stage;
  if (assignedAdminId) where.assigned_admin_id = assignedAdminId;

  // Filtros de busca por dados declarados
  const search = `${query.q ?? query.search ?? ''}`.trim();

  let rows;
  let total;

  if (search && search.length >= 2) {
    const needle = `%${search}%`;
    rows = await sequelize.query(
      `
      SELECT
        arr.id,
        arr.temp_account_id,
        arr.original_user_id,
        arr.declared_full_name,
        arr.declared_old_email,
        arr.declared_old_phone,
        arr.declared_old_access_channel,
        arr.sync_stage,
        arr.stage_updated_at,
        arr.assigned_admin_id,
        arr.expires_at,
        arr.merged_at,
        arr.cancelled_at,
        arr.created_at,
        u.email AS temp_user_email
      FROM account_recovery_requests arr
      LEFT JOIN temporary_users u ON u.id = arr.temp_account_id
      WHERE arr.deleted_at IS NULL
        ${stage && VALID_STAGES.includes(stage) ? `AND arr.sync_stage = '${stage}'` : ''}
        AND (
          arr.declared_full_name ILIKE :needle
          OR arr.declared_old_email ILIKE :needle
          OR arr.declared_old_phone ILIKE :needle
          OR u.email ILIKE :needle
        )
      ORDER BY arr.created_at DESC
      LIMIT :limit OFFSET :offset
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { needle, limit, offset },
      }
    );

    const [countRow] = await sequelize.query(
      `
      SELECT COUNT(*) AS total
      FROM account_recovery_requests arr
      LEFT JOIN temporary_users u ON u.id = arr.temp_account_id
      WHERE arr.deleted_at IS NULL
        ${stage && VALID_STAGES.includes(stage) ? `AND arr.sync_stage = '${stage}'` : ''}
        AND (
          arr.declared_full_name ILIKE :needle
          OR arr.declared_old_email ILIKE :needle
          OR arr.declared_old_phone ILIKE :needle
          OR u.email ILIKE :needle
        )
      `,
      { type: QueryTypes.SELECT, replacements: { needle } }
    );
    total = parseInt(countRow?.total ?? '0', 10);
  } else {
    const { count, rows: dbRows } = await AccountRecoveryRequest.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC']],
      include: [
        { model: TemporaryUser, as: 'temp_account', attributes: ['id', 'email'], required: false },
        { model: User, as: 'original_user', attributes: ['id', 'email'], required: false },
        { model: User, as: 'assigned_admin', attributes: ['id', 'email'], required: false },
      ],
    });
    rows = dbRows.map((r) => r.get({ plain: true }));
    total = count;
  }

  return { items: rows, total, limit, offset };
}

/**
 * GET /admin/recovery/:id
 * Detalhe completo de uma solicitação, incluindo mensagens.
 */
async function getRecoveryRequestDetail(requestId) {
  const id = `${requestId ?? ''}`.trim();
  if (!id) throw new AppError('ID inválido.', 400, null, true);

  const request = await AccountRecoveryRequest.findByPk(id, {
    include: [
      { model: TemporaryUser, as: 'temp_account', attributes: ['id', 'email', 'phone', 'is_active', 'blocked_at', 'created_at'] },
      { model: User, as: 'original_user', attributes: ['id', 'email', 'phone', 'is_active'], required: false },
      { model: User, as: 'assigned_admin', attributes: ['id', 'email'], required: false },
    ],
  });

  if (!request) throw new AppError('Solicitação não encontrada.', 404, null, true);

  const messages = await AccountRecoveryMessage.findAll({
    where: { request_id: id, deleted_at: null },
    order: [['created_at', 'ASC']],
    include: [{ model: User, as: 'sender_user', attributes: ['id', 'email'], required: false }],
  });

  return {
    ...request.get({ plain: true }),
    messages: messages.map((m) => m.get({ plain: true })),
  };
}

/**
 * GET /admin/recovery/:id/candidates
 * Busca contas de usuário que podem ser a conta original — ajuda o admin a localizar
 * sem precisar saber o ID de cor. Usa os dados declarados da própria solicitação como dica.
 */
async function findOriginalUserCandidates(requestId, query = {}) {
  const id = `${requestId ?? ''}`.trim();
  if (!id) throw new AppError('ID inválido.', 400, null, true);

  const request = await AccountRecoveryRequest.findByPk(id, {
    attributes: ['id', 'temp_account_id', 'declared_old_email', 'declared_old_phone', 'declared_full_name'],
  });
  if (!request) throw new AppError('Solicitação não encontrada.', 404, null, true);

  // Pesquisa livre sobrepõe os dados declarados
  const searchOverride = `${query.q ?? ''}`.trim();
  const needle = searchOverride || request.declared_full_name || '';
  const emailHint = searchOverride || request.declared_old_email || '';
  const phoneHint = searchOverride || request.declared_old_phone || '';

  if (!needle && !emailHint && !phoneHint) {
    throw new AppError('Sem dados suficientes para buscar candidatos. Use ?q=termo.', 400, null, true);
  }

  const like = `%${needle}%`;
  const emailLike = emailHint ? `%${emailHint.toLowerCase()}%` : null;
  const phoneLike = phoneHint ? `%${phoneHint.replace(/\D/g, '')}%` : null;

  const rows = await sequelize.query(
    `
    SELECT
      u.id AS user_id,
      u.email,
      u.phone,
      u.is_active,
      u.blocked_at,
      u.last_login_at,
      u.created_at AS user_created_at,
      c.id AS client_id,
      c.nome_completo,
      c.nome_id,
      c.apelido,
      c.cpf
    FROM users u
    LEFT JOIN clients c ON c.user_id = u.id AND c.deleted_at IS NULL
    WHERE u.deleted_at IS NULL
      AND u.id != :tempUserId
      AND u.role = 'CLIENTE'
      AND (
        c.nome_completo ILIKE :like
        OR c.nome_id ILIKE :like
        OR c.nome ILIKE :like
        ${emailLike ? 'OR u.email ILIKE :emailLike' : ''}
        ${phoneLike ? `OR regexp_replace(coalesce(u.phone,''), '\\D','','g') LIKE :phoneLike` : ''}
      )
    ORDER BY u.last_login_at DESC NULLS LAST
    LIMIT 20
    `,
    {
      type: QueryTypes.SELECT,
      replacements: {
        tempAccountId: request.temp_account_id,
        like,
        ...(emailLike ? { emailLike } : {}),
        ...(phoneLike ? { phoneLike } : {}),
      },
    }
  );

  return {
    request_hints: {
      declared_full_name: request.declared_full_name,
      declared_old_email: request.declared_old_email,
      declared_old_phone: request.declared_old_phone,
    },
    candidates: rows,
  };
}

module.exports = {
  listRecoveryRequests,
  getRecoveryRequestDetail,
  findOriginalUserCandidates,
};
