const { Model, DataTypes } = require('sequelize');

const SENDER_ROLES = ['USER', 'ADMIN', 'SYSTEM'];

class AccountRecoveryMessage extends Model {}

module.exports = (sequelize) => {
  AccountRecoveryMessage.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      request_id: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: 'FK para account_recovery_requests',
      },
      sender_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'NULL = mensagem de sistema; caso contrário, quem enviou',
      },
      sender_role: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'SYSTEM',
        comment: 'USER | ADMIN | SYSTEM',
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      read_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Preenchido pelo admin ao marcar como lida',
      },
    },
    {
      sequelize,
      modelName: 'AccountRecoveryMessage',
      tableName: 'account_recovery_messages',
      paranoid: true,
      indexes: [
        {
          name: 'arm_request_id_created_idx',
          fields: ['request_id', 'created_at'],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
        {
          name: 'arm_sender_user_id_idx',
          fields: ['sender_user_id'],
          where: sequelize.literal('"sender_user_id" IS NOT NULL'),
        },
      ],
    }
  );

  AccountRecoveryMessage.SENDER_ROLES = SENDER_ROLES;
  return AccountRecoveryMessage;
};
