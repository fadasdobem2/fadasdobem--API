const { Model, DataTypes } = require('sequelize');

/**
 * Etapas de sincronização de conta:
 *   PENDING_REVIEW   – solicitação recebida, aguarda análise do admin
 *   IDENTITY_CHECK   – admin localizou a conta antiga, verificando identidade
 *   MERGING          – merge em andamento (créditos, histórico, vínculos)
 *   MERGED           – sincronização concluída; conta temporária deve ser desativada após N dias
 *   REJECTED         – solicitação negada (fraude, dados insuficientes, etc.)
 *   CANCELLED        – usuário desistiu ou expirou sem ação
 */
const SYNC_STAGES = ['PENDING_REVIEW', 'IDENTITY_CHECK', 'MERGING', 'MERGED', 'REJECTED', 'CANCELLED'];

/**
 * Canal pelo qual o usuário declarou acessar a conta antiga.
 */
const OLD_ACCESS_CHANNELS = ['EMAIL', 'WHATSAPP', 'BOTH', 'UNKNOWN'];

class AccountRecoveryRequest extends Model {}

module.exports = (sequelize) => {
  AccountRecoveryRequest.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },

      /* ── Conta temporária criada para o usuário retomar o acesso ── */

      temp_account_id: {
        type: DataTypes.UUID,
        allowNull: false,
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        comment: 'TemporaryUser em temporary_users — conta temporária de recuperação',
      },

      /* ── Conta antiga que deverá ser localizada e mesclada ── */

      /**
       * Preenchido pelo admin após localizar a conta antiga no sistema.
       * NULL enquanto o merge não foi iniciado.
       */
      original_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'User original localizado pelo admin; preenchido na etapa IDENTITY_CHECK→MERGING',
      },

      /* ── Dados declarados pelo usuário para ajudar na localização ── */

      declared_full_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: 'Nome completo informado no formulário de recuperação',
      },
      declared_old_email: {
        type: DataTypes.STRING(320),
        allowNull: true,
        comment: 'Email da conta antiga informado pelo usuário (pode ser nulo se só lembrou o WhatsApp)',
      },
      declared_old_phone: {
        type: DataTypes.STRING(32),
        allowNull: true,
        comment: 'Telefone/WhatsApp da conta antiga (pode ser nulo se só lembrou o email)',
      },
      declared_old_access_channel: {
        type: DataTypes.ENUM(...OLD_ACCESS_CHANNELS),
        allowNull: false,
        defaultValue: 'UNKNOWN',
        comment: 'Canal que o usuário declarou usar para acessar a conta antiga',
      },

      /* ── Pistas de identidade fornecidas para verificação manual ── */

      identity_hint_nickname: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: 'Apelido/nome usado pelas tarólogas — campo "Como a taróloga te chama?"',
      },
      identity_hint_specialists: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Nomes de tarólogas que já atenderam o usuário (texto livre separado por vírgula)',
      },
      identity_hint_extra: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'Campos adicionais de verificação coletados em versões futuras do formulário',
      },

      /* ── Controle de etapa e resolução ── */

      sync_stage: {
        type: DataTypes.ENUM(...SYNC_STAGES),
        allowNull: false,
        defaultValue: 'PENDING_REVIEW',
        comment: 'Etapa atual do processo de sincronização',
      },
      stage_updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp da última mudança de sync_stage',
      },

      /* ── Admin responsável e notas internas ── */

      assigned_admin_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Admin que assumiu a análise desta solicitação',
      },
      admin_notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Observações internas do admin — visíveis apenas para a equipe',
      },
      rejection_reason: {
        type: DataTypes.STRING(512),
        allowNull: true,
        comment: 'Motivo do reject (exibível ao usuário em versão sanitizada)',
      },

      /* ── Rastreio de origem (segurança / anti-fraude) ── */

      request_ip: {
        type: DataTypes.STRING(45),
        allowNull: true,
        comment: 'IP de origem da solicitação (IPv4 ou IPv6)',
      },
      request_user_agent: {
        type: DataTypes.STRING(512),
        allowNull: true,
        comment: 'User-agent do navegador no momento da solicitação',
      },
      request_metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'Metadados adicionais da requisição (headers relevantes, fingerprint, etc.)',
      },

      /* ── Resolução final ── */

      merged_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp em que o merge foi concluído (sync_stage = MERGED)',
      },
      cancelled_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp de cancelamento/expiração (sync_stage = CANCELLED)',
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Se não resolvido até esta data, a solicitação expira automaticamente',
      },
    },
    {
      sequelize,
      modelName: 'AccountRecoveryRequest',
      tableName: 'account_recovery_requests',
      paranoid: true,
      indexes: [
        { name: 'arr_temp_account_id_idx', fields: ['temp_account_id'] },
        {
          name: 'arr_original_user_id_idx',
          fields: ['original_user_id'],
          where: sequelize.literal('"original_user_id" IS NOT NULL'),
        },
        {
          name: 'arr_sync_stage_idx',
          fields: ['sync_stage'],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
        {
          name: 'arr_assigned_admin_id_idx',
          fields: ['assigned_admin_id'],
          where: sequelize.literal('"assigned_admin_id" IS NOT NULL AND "deleted_at" IS NULL'),
        },
        {
          name: 'arr_declared_old_email_idx',
          fields: ['declared_old_email'],
          where: sequelize.literal('"declared_old_email" IS NOT NULL'),
        },
        {
          name: 'arr_declared_old_phone_idx',
          fields: ['declared_old_phone'],
          where: sequelize.literal('"declared_old_phone" IS NOT NULL'),
        },
        {
          name: 'arr_expires_at_idx',
          fields: ['expires_at'],
          where: sequelize.literal('"expires_at" IS NOT NULL AND "deleted_at" IS NULL'),
        },
        { name: 'arr_created_at_idx', fields: [{ name: 'created_at', order: 'DESC' }] },
      ],
    }
  );

  AccountRecoveryRequest.SYNC_STAGES = SYNC_STAGES;
  AccountRecoveryRequest.OLD_ACCESS_CHANNELS = OLD_ACCESS_CHANNELS;

  return AccountRecoveryRequest;
};
