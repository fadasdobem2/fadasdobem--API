const { Model, DataTypes } = require('sequelize');

class TemporaryUser extends Model {}

module.exports = (sequelize) => {
  TemporaryUser.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      email: {
        type: DataTypes.STRING(320),
        allowNull: false,
        // UNIQUE de coluna inteira (constraint), como na migração 20260618115000; não é índice parcial.
        unique: 'temporary_users_email_active_uidx',
      },
      password_hash: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      role: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'CLIENTE',
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      blocked_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      block_reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      last_login_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      openai_thread_id: {
        type: DataTypes.STRING(128),
        allowNull: true,
      },
      onboarding_step: {
        type: DataTypes.SMALLINT,
        allowNull: false,
        defaultValue: 1,
      },
      email_verified_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      accepted_terms_version: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      accepted_terms_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'TemporaryUser',
      tableName: 'temporary_users',
      paranoid: true,
      indexes: [
        {
          name: 'tu_email_idx',
          fields: ['email'],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
      ],
    }
  );

  return TemporaryUser;
};
