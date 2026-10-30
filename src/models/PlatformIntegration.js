const { Model, DataTypes } = require('sequelize');

/** Provedores suportados no painel administrativo (expandir conforme novos gateways). */
const PROVIDERS = ['EVOLUTION_API', 'CHATWOOT_GLOBAL', 'OTHER'];

/** Estado operacional observado pela API-proxy e jobs de sincronização. */
const CONNECTION_STATUSES = ['CONNECTING', 'CONNECTED', 'DISCONNECTED', 'QRCODE'];

class PlatformIntegration extends Model {}

module.exports = (sequelize) => {
  PlatformIntegration.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      instance_name: {
        type: DataTypes.STRING(160),
        allowNull: false,
        comment:
          'Identificação amigável da instância (Evolution ou contexto nomeado para global Chatwoot).',
      },
      provider: {
        type: DataTypes.ENUM(...PROVIDERS),
        allowNull: false,
      },
      connection_status: {
        type: DataTypes.ENUM(...CONNECTION_STATUSES),
        allowNull: false,
        defaultValue: 'DISCONNECTED',
      },
      qr_code_base64: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'QR atual para onboarding WhatsApp quando `connection_status=QRCODE` ou equivalente Evolution.',
      },
      chatwoot_account_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'ID da conta/workspace Chatwoot alinhado à integração quando aplicável.',
      },
      chatwoot_inbox_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      access_token_cipher: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment:
          'Token ou segredo já cifrado pela camada de aplicação (nunca armazener texto plano em PRD).',
      },
      last_connected_at: { type: DataTypes.DATE, allowNull: true },
      disconnected_reason: { type: DataTypes.TEXT, allowNull: true },
      configured_by_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Último usuário com papel Gestora que persistiu configurações via painel (auditoria).',
      },
    },
    {
      sequelize,
      modelName: 'PlatformIntegration',
      tableName: 'platform_integrations',
      paranoid: true,
      indexes: [
        { fields: ['provider'] },
        { fields: ['connection_status'] },
        {
          unique: true,
          name: 'platform_integrations_provider_instance_active_uidx',
          fields: ['provider', 'instance_name'],
          where: { deleted_at: null },
        },
        { fields: ['configured_by_user_id'] },
      ],
    }
  );

  PlatformIntegration.PROVIDERS = PROVIDERS;
  PlatformIntegration.CONNECTION_STATUSES = CONNECTION_STATUSES;
  return PlatformIntegration;
};
