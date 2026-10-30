const { Model, DataTypes } = require('sequelize');
const { USER_ROLE_VALUES } = require('../rbac/rbac.constants');

/** Enum de `users.role` derivado da fonte única em `rbac.constants` (sem duplicação). */
const ROLES = USER_ROLE_VALUES;

class User extends Model {}

module.exports = (sequelize) => {
  User.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      email: {
        type: DataTypes.STRING(320),
        allowNull: false,
        validate: { isEmail: true },
      },
      password_hash: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Nulo quando o login é 100% OAuth',
      },
      role: {
        type: DataTypes.ENUM(...ROLES),
        allowNull: false,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      blocked_at: { type: DataTypes.DATE, allowNull: true },
      block_reason: { type: DataTypes.TEXT, allowNull: true },
      email_verified_at: { type: DataTypes.DATE, allowNull: true, comment: 'Null até confirmação (R7)' },
      phone: { type: DataTypes.STRING(32), allowNull: true },
      phone_verified_at: { type: DataTypes.DATE, allowNull: true },
      last_login_at: { type: DataTypes.DATE, allowNull: true },
      accepted_terms_version: {
        type: DataTypes.STRING(32),
        allowNull: true,
        comment: 'Versão textual dos Termos aceitos (LGPD)',
      },
      accepted_terms_at: { type: DataTypes.DATE, allowNull: true },
      chatwoot_contact_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'Lead/cadastro provisório originado no Chatwoot',
      },
      chatwoot_conversation_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      onboarding_step: {
        type: DataTypes.SMALLINT,
        allowNull: false,
        defaultValue: 0,
        comment: 'Cadastro progressivo: etapa atual do wizard',
      },
      onboarding_completed_at: { type: DataTypes.DATE, allowNull: true },
      locale: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pt-BR' },
      timezone: { type: DataTypes.STRING(64), allowNull: true },
      marketing_opt_in: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      profile_avatar_url: {
        type: DataTypes.STRING(512),
        allowNull: true,
        comment: 'Avatar genérico da conta (além dos avatares de vitrine)',
      },
      email_pending_review: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'R7 — mais de 7 dias sem confirmar email; alerta operações',
      },
      mercadopago_customer_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'ID de cliente no MP para cobrança recorrente/cartões salvos',
      },
      fraud_score: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
        comment: 'Score interno anti-fraude (0-100), preenchido por regras futuras',
      },
      openai_thread_id: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: 'Threads API (Assistants/OpenAI): continuidade contextual por usuário',
      },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      paranoid: true,
      indexes: [
        {
          unique: true,
          name: 'users_email_deleted_at_null_uidx',
          fields: ['email'],
          where: { deleted_at: null },
        },
        { fields: ['role'] },
        {
          unique: true,
          name: 'users_chatwoot_contact_id_deleted_at_null_uidx',
          fields: ['chatwoot_contact_id'],
          where: { deleted_at: null },
        },
        { fields: ['chatwoot_conversation_id'] },
        { fields: ['openai_thread_id'] },
      ],
    }
  );

  User.ROLES = ROLES;
  return User;
};
