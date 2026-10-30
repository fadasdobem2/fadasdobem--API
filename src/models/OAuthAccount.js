const { Model, DataTypes } = require('sequelize');

const PROVIDERS = ['GOOGLE', 'APPLE', 'FACEBOOK', 'OTHER'];

class OAuthAccount extends Model {}

module.exports = (sequelize) => {
  OAuthAccount.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      provider: {
        type: DataTypes.ENUM(...PROVIDERS),
        allowNull: false,
      },
      provider_user_id: {
        type: DataTypes.STRING(191),
        allowNull: false,
      },
      access_token_cipher: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Opcional criptografado — preferir fluxo sem armazenar token long-lived',
      },
      refresh_token_cipher: { type: DataTypes.TEXT, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true },
      profile_payload: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Snapshot do perfil OAuth para auditoria',
      },
    },
    {
      sequelize,
      modelName: 'OAuthAccount',
      tableName: 'oauth_accounts',
      paranoid: true,
      indexes: [
        {
          unique: true,
          name: 'oauth_accounts_provider_subject_deleted_at_null_uidx',
          fields: ['provider', 'provider_user_id'],
          where: { deleted_at: null },
        },
        { fields: ['user_id'] },
      ],
    }
  );

  OAuthAccount.PROVIDERS = PROVIDERS;
  return OAuthAccount;
};
