'use strict';

const bcrypt = require('bcryptjs');
const { UniqueConstraintError } = require('sequelize');
const {
  sequelize,
  TemporaryUser,
  TemporaryClient,
  AccountRecoveryRequest,
  AccountRecoveryMessage,
} = require('../../models');
const AppError = require('../../utils/AppError');
const {
  AUTH_CONFIG,
  AUTH_MESSAGES,
  normalizeEmail,
  assertEmailFormat,
  assertPasswordPolicy,
} = require('../auth/auth.constants');
const { isDisposableEmailAddress } = require('../../config/disposableEmails.config');
const { recordAuthSecurityAudit } = require('../auth/auth.audit.helper');
const { issueTokenPairForUser, sanitizeUserRecord, enqueueEmailVerification } = require('../auth/auth.service');

const RECOVERY_MESSAGES = {
  EMAIL_REQUIRED: 'Informe um e-mail para a conta temporária.',
  PASSWORD_REQUIRED: 'Informe uma senha para a conta temporária.',
  NAME_REQUIRED: 'Informe seu nome completo.',
  OLD_CONTACT_REQUIRED: 'Informe ao menos o WhatsApp antigo ou o e-mail antigo para localizarmos sua conta.',
  REQUEST_NOT_FOUND: 'Solicitação de recuperação não encontrada.',
  REQUEST_ALREADY_DONE: 'Esta solicitação já foi concluída ou cancelada.',
  MESSAGE_BODY_REQUIRED: 'O corpo da mensagem não pode estar vazio.',
  MESSAGE_TOO_LONG: 'Mensagem muito longa (máx. 2000 caracteres).',
  NOT_TEMP_ACCOUNT: 'Esta conta não possui uma solicitação de recuperação ativa.',
};

/**
 * POST /v1/account-recovery/request
 * Cria a conta temporária + a solicitação de recuperação atomicamente.
 */
async function createRecoveryRequest(body = {}, reqMeta = {}) {
  // --- validações ---
  const fullName = `${body.nome_completo ?? body.nome ?? ''}`.trim();
  if (!fullName) throw new AppError(RECOVERY_MESSAGES.NAME_REQUIRED, 400, null, true);

  assertEmailFormat(body.email_novo ?? body.email);
  const mail = normalizeEmail(body.email_novo ?? body.email);

  if (isDisposableEmailAddress(mail)) {
    throw new AppError(AUTH_MESSAGES.EMAIL_DISPOSABLE, 400, null, true);
  }

  assertPasswordPolicy(body.senha_nova ?? body.password);

  const oldPhone = `${body.whatsapp_antigo ?? body.old_phone ?? ''}`.trim();
  const oldEmail = `${body.email_antigo ?? body.old_email ?? ''}`.trim();

  if (!oldPhone && !oldEmail) {
    throw new AppError(RECOVERY_MESSAGES.OLD_CONTACT_REQUIRED, 400, null, true);
  }

  const existingInUsers = await require('../../models').User.findOne({ where: { email: mail } });
  const existingInTemp = await TemporaryUser.findOne({ where: { email: mail } });
  if (existingInUsers || existingInTemp) throw new AppError(AUTH_MESSAGES.EMAIL_ALREADY_REGISTERED, 409, null, true);

  const passwordHash = await bcrypt.hash(body.senha_nova ?? body.password, AUTH_CONFIG.bcryptCostPassword);

  let tempUser;
  let recoveryRequest;

  try {
    await sequelize.transaction(async (t) => {
      // Criado em temporary_users — NÃO em users
      tempUser = await TemporaryUser.create(
        {
          email: mail,
          password_hash: passwordHash,
          role: AUTH_CONFIG.roleClienteNoRegistro,
          onboarding_step: AUTH_CONFIG.onboardingStepAfterRegister,
          accepted_terms_version: `${body.accepted_terms_version ?? '1.0'}`.trim(),
          accepted_terms_at: new Date(),
          is_active: true,
        },
        { transaction: t }
      );

      await TemporaryClient.create(
        {
          temp_user_id: tempUser.id,
          nome_completo: fullName.slice(0, AUTH_CONFIG.profileNomeMaxLength),
          nome: fullName.slice(0, AUTH_CONFIG.profileNomeMaxLength),
          apelido: `${body.apelido ?? ''}`.trim().slice(0, 80) || null,
        },
        { transaction: t }
      );

      const channel = oldPhone && oldEmail ? 'BOTH' : oldPhone ? 'WHATSAPP' : 'EMAIL';

      recoveryRequest = await AccountRecoveryRequest.create(
        {
          temp_account_id: tempUser.id,
          original_user_id: null,
          declared_full_name: fullName,
          declared_old_email: oldEmail || null,
          declared_old_phone: oldPhone || null,
          declared_old_access_channel: channel,
          identity_hint_nickname: `${body.apelido ?? ''}`.trim().slice(0, 128) || null,
          identity_hint_specialists: `${body.tarologas ?? body.specialists ?? ''}`.trim().slice(0, 1000) || null,
          identity_hint_extra: {},
          sync_stage: 'PENDING_REVIEW',
          stage_updated_at: new Date(),
          request_ip: `${reqMeta.ip ?? ''}`.slice(0, 45) || null,
          request_user_agent: `${reqMeta.userAgent ?? ''}`.slice(0, 512) || null,
          request_metadata: {},
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias
        },
        { transaction: t }
      );

      // Mensagem de sistema confirmando a abertura
      await AccountRecoveryMessage.create(
        {
          request_id: recoveryRequest.id,
          sender_user_id: null,
          sender_role: 'SYSTEM',
          body: 'Solicitação de recuperação de conta recebida. Nossa equipe entrará em contato em breve (segunda a sábado, 9h–22h).',
        },
        { transaction: t }
      );
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError || err.name === 'SequelizeUniqueConstraintError') {
      throw new AppError(AUTH_MESSAGES.EMAIL_ALREADY_REGISTERED, 409, null, true);
    }
    throw err;
  }

  tempUser = await TemporaryUser.findByPk(tempUser.id, {
    include: [{ model: TemporaryClient, as: 'client_profile', required: false }],
  });

  await recordAuthSecurityAudit({
    action: 'AUTH_RECOVERY_REQUEST_CREATED',
    userId: tempUser.id,
    ip: reqMeta.ip,
    userAgent: reqMeta.userAgent,
    metadata: { recovery_request_id: recoveryRequest.id },
  });

  void enqueueEmailVerification(tempUser.id, mail, reqMeta);

  const tokens = await issueTokenPairForUser(tempUser, { accountType: 'temp' });
  return {
    ...tokens,
    usuario: sanitizeUserRecord(tempUser),
    recovery_request: {
      id: recoveryRequest.id,
      sync_stage: recoveryRequest.sync_stage,
      expires_at: recoveryRequest.expires_at,
    },
  };
}

/**
 * GET /v1/account-recovery/status
 * Retorna o status da solicitação de recuperação do usuário autenticado.
 */
async function getMyRecoveryStatus(userId) {
  const request = await AccountRecoveryRequest.findOne({
    where: { temp_account_id: userId, deleted_at: null },
    order: [['created_at', 'DESC']],
  });

  if (!request) throw new AppError(RECOVERY_MESSAGES.NOT_TEMP_ACCOUNT, 404, null, true);

  const messages = await AccountRecoveryMessage.findAll({
    where: { request_id: request.id, deleted_at: null },
    order: [['created_at', 'ASC']],
    attributes: ['id', 'sender_role', 'body', 'read_at', 'created_at'],
  });

  const STAGE_LABELS = {
    PENDING_REVIEW: 'Aguardando análise',
    IDENTITY_CHECK: 'Verificando identidade',
    MERGING: 'Sincronização em andamento',
    MERGED: 'Conta sincronizada',
    REJECTED: 'Solicitação negada',
    CANCELLED: 'Solicitação cancelada',
  };

  return {
    id: request.id,
    sync_stage: request.sync_stage,
    sync_stage_label: STAGE_LABELS[request.sync_stage] ?? request.sync_stage,
    stage_updated_at: request.stage_updated_at,
    rejection_reason: request.rejection_reason,
    expires_at: request.expires_at,
    created_at: request.created_at,
    messages,
  };
}

/**
 * POST /v1/account-recovery/message
 * Usuário envia mensagem para o suporte dentro da solicitação de recuperação.
 */
async function sendUserMessage(userId, body = {}) {
  const text = `${body.mensagem ?? body.message ?? body.body ?? ''}`.trim();
  if (!text) throw new AppError(RECOVERY_MESSAGES.MESSAGE_BODY_REQUIRED, 400, null, true);
  if (text.length > 2000) throw new AppError(RECOVERY_MESSAGES.MESSAGE_TOO_LONG, 400, null, true);

  const request = await AccountRecoveryRequest.findOne({
    where: { temp_account_id: userId, deleted_at: null },
    order: [['created_at', 'DESC']],
  });

  if (!request) throw new AppError(RECOVERY_MESSAGES.NOT_TEMP_ACCOUNT, 404, null, true);

  const terminal = ['MERGED', 'REJECTED', 'CANCELLED'];
  if (terminal.includes(request.sync_stage)) {
    throw new AppError(RECOVERY_MESSAGES.REQUEST_ALREADY_DONE, 409, null, true);
  }

  const message = await AccountRecoveryMessage.create({
    request_id: request.id,
    sender_user_id: userId,
    sender_role: 'USER',
    body: text,
    read_at: null,
  });

  return {
    id: message.id,
    sender_role: message.sender_role,
    body: message.body,
    created_at: message.created_at,
  };
}

module.exports = { createRecoveryRequest, getMyRecoveryStatus, sendUserMessage };
