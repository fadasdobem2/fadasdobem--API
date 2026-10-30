'use strict';

/**
 * Pós-sessão: avaliação da cliente titular (1 por sessão, auditada) e mensagem
 * ritualística da taróloga atribuída. Ambas exigem sessão elegível (encerrada
 * ao nível telecom/lifecycle) e registam AuditLog.
 */
const { Session, Review, AuditLog, Specialist } = require('../../models');
const { sequelize } = require('../../config/database');
const AppError = require('../../utils/AppError');
const { clientColumn, sessionBelongsToClient } = require('../../utils/clientRef.util');
const { sessionAllowsClientReview } = require('./sessions.shared');

/**
 * POST sessão/avaliação — **apenas** a cliente titular (`users.role === CLIENTE` + `client_profile`).
 *
 * @param {import('../../models/User')} user
 * @param {Record<string, unknown>} [body]
 * @param {{ ip?: string; userAgent?: string; correlationId?: string }} [httpCtx]
 */
async function submitSessionReview(user, sessionId, body = {}, httpCtx = {}) {
  if (`${user?.role || ''}`.trim().toUpperCase() !== 'CLIENTE') {
    throw new AppError('Apenas clientes registadas podem submeter avaliações.', 403, null, true);
  }

  const clientProf = user.client_profile;
  if (!clientProf?.id) {
    throw new AppError('Perfil cliente incompleto — não é possível avaliar.', 403, null, true);
  }

  const sid = `${sessionId || ''}`.trim();
  if (!sid) {
    throw new AppError('Identificador de sessão em falta.', 400, null, true);
  }

  const ratingRaw =
    typeof body?.rating === 'number' ? body.rating : parseInt(`${body?.rating ?? ''}`, 10);
  if (!Number.isInteger(ratingRaw) || ratingRaw < 1 || ratingRaw > 5) {
    throw new AppError('Informe uma nota `rating` inteira entre 1 e 5.', 400, null, true);
  }

  const commentRaw =
    typeof body?.comment === 'string' ? body.comment.trim() : `${body?.comment ?? ''}`.trim();
  const comment = commentRaw.slice(0, 4000) || null;

  const is_public =
    body?.is_public !== undefined ? Boolean(body.is_public === true || body.is_public === 'true') : true;

  const existingReview = await Review.findOne({
    where: { session_id: sid },
    paranoid: true,
    attributes: ['id'],
  });
  if (existingReview) {
    throw new AppError('Esta sessão já possui avaliação.', 409, null, true);
  }

  const session = await Session.findByPk(sid, {
    paranoid: true,
    attributes: ['id', 'client_id', 'temp_client_id', 'specialist_id', 'status', 'ended_at', 'telecom_status'],
  });

  if (!session) {
    throw new AppError('Sessão não encontrada.', 404, null, true);
  }

  if (!sessionBelongsToClient(session, user, clientProf.id)) {
    throw new AppError('Só a cliente titular desta sessão pode avaliar.', 403, null, true);
  }

  if (!sessionAllowsClientReview(session)) {
    throw new AppError(
      'A sessão ainda não está elegível para avaliação — aguarde o encerramento da consulta.',
      409,
      null,
      true
    );
  }

  let reviewRow;
  await sequelize.transaction(async (t) => {
    const dupAgain = await Review.findOne({
      where: { session_id: sid },
      transaction: t,
      lock: t.LOCK.UPDATE,
      paranoid: true,
      attributes: ['id'],
    });
    if (dupAgain) {
      throw new AppError('Esta sessão já possui avaliação.', 409, null, true);
    }

    reviewRow = await Review.create(
      {
        session_id: sid,
        [clientColumn(user)]: clientProf.id,
        specialist_id: session.specialist_id,
        rating: ratingRaw,
        comment,
        is_public,
      },
      { transaction: t }
    );

    await AuditLog.create(
      {
        admin_id: null,
        action: 'SESSION_CLIENT_REVIEW_SUBMIT',
        target_entity: 'Review',
        target_id: reviewRow.id,
        old_value: null,
        new_value: {
          session_id: sid,
          specialist_id: session.specialist_id,
          rating: ratingRaw,
          is_public,
          comment_preview: comment ? `${comment.slice(0, 240)}${comment.length > 240 ? '…' : ''}` : null,
        },
        metadata: {
          client_user_id: user.id,
          client_id: clientProf.id,
        },
        ip_address: `${httpCtx.ip || ''}`.trim().slice(0, 45) || null,
        user_agent:
          `${httpCtx.userAgent || ''}`.trim().slice(0, 2000) || null,
        correlation_id: `${httpCtx.correlationId || ''}`.trim().slice(0, 64) || null,
        occurred_at: new Date(),
      },
      { transaction: t }
    );
  });

  return {
    review_id: reviewRow.id,
    session_id: sid,
    specialist_id: session.specialist_id,
    rating: reviewRow.rating,
    comment: reviewRow.comment,
    is_public: reviewRow.is_public,
  };
}

const RITUAL_MSG_MAX = 1500;

/**
 * PATCH ritual — apenas a tarólogo atribuída; sessão já encerrada à luz telecom / lifecycle.
 *
 * @param {import('../../models/User')} user
 * @param {Record<string, unknown>} body
 */
async function patchPostSessionRitual(user, sessionId, body = {}, httpCtx = {}) {
  const sid = `${sessionId || ''}`.trim();
  if (!sid) throw new AppError('Identificador de sessão em falta.', 400, null, true);

  const specialist = await Specialist.findOne({
    where: { user_id: user.id },
    paranoid: true,
    attributes: ['id'],
  });
  if (!specialist?.id) {
    throw new AppError('Perfil tarólogo não encontrado.', 403, null, true);
  }

  const raw =
    body?.post_session_message != null
      ? `${body.post_session_message}`
      : body?.postSessionMessage != null
        ? `${body.postSessionMessage}`
        : '';
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new AppError('Informe `post_session_message`.', 400, null, true);
  }
  if (trimmed.length > RITUAL_MSG_MAX) {
    throw new AppError(`Máximo ${RITUAL_MSG_MAX} caracteres na mensagem ritualística.`, 400, null, true);
  }

  const session = await Session.findByPk(sid, {
    paranoid: true,
    attributes: ['id', 'specialist_id', 'status', 'ended_at', 'telecom_status', 'post_session_message'],
  });
  if (!session) throw new AppError('Sessão não encontrada.', 404, null, true);
  if (`${session.specialist_id}` !== `${specialist.id}`) {
    throw new AppError('Só a tarólogo desta sessão pode enviar a mensagem ritualística.', 403, null, true);
  }

  if (!sessionAllowsClientReview(session)) {
    throw new AppError(
      'A sessão ainda não está encerrada ao nível telecom / lifecycle — mensagem não disponível.',
      409,
      null,
      true
    );
  }

  const prevMsg = session.post_session_message ? `${session.post_session_message}` : null;

  await sequelize.transaction(async (t) => {
    await session.reload({
      paranoid: true,
      transaction: t,
      lock: t.LOCK.UPDATE,
      attributes: ['id', 'specialist_id', 'telecom_status', 'ended_at', 'status'],
    });

    if (`${session.specialist_id}` !== `${specialist.id}`) {
      throw new AppError('Só a tarólogo desta sessão pode enviar a mensagem ritualística.', 403, null, true);
    }
    if (!sessionAllowsClientReview(session)) {
      throw new AppError(
        'A sessão já não está elegível neste momento.',
        409,
        null,
        true
      );
    }

    await Session.update(
      { post_session_message: trimmed },
      { where: { id: sid }, transaction: t }
    );

    await AuditLog.create(
      {
        admin_id: null,
        action: 'SESSION_POST_RITUAL_MESSAGE',
        target_entity: 'Session',
        target_id: sid,
        old_value: prevMsg
          ? { post_session_message_preview: `${prevMsg.slice(0, 120)}${prevMsg.length > 120 ? '…' : ''}` }
          : null,
        new_value: {
          post_session_message_preview: `${trimmed.slice(0, 120)}${trimmed.length > 120 ? '…' : ''}`,
        },
        metadata: { specialist_user_id: user.id, specialist_id: specialist.id },
        ip_address: `${httpCtx.ip || ''}`.trim().slice(0, 45) || null,
        user_agent: `${httpCtx.userAgent || ''}`.trim().slice(0, 2000) || null,
        correlation_id: `${httpCtx.correlationId || ''}`.trim().slice(0, 64) || null,
        occurred_at: new Date(),
      },
      { transaction: t }
    );
  });

  const fresh = await Session.findByPk(sid, {
    paranoid: true,
    attributes: ['id', 'post_session_message', 'specialist_id', 'telecom_status', 'status', 'ended_at'],
  });

  return {
    session_id: sid,
    post_session_message: fresh?.post_session_message ?? trimmed,
    specialist_id: specialist.id,
    telecom_status: fresh?.telecom_status,
    session_status: fresh?.status,
  };
}

module.exports = {
  submitSessionReview,
  patchPostSessionRitual,
};
