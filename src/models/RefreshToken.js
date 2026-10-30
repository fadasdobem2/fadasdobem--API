const { Model, DataTypes } = require('sequelize');

class RefreshToken extends Model {}

/**
 * Sessões de refresh JWT persistidas para rotação e revogação (logout).
 * Não armazenamos o token em claro — apenas o `jti` presente no payload assinado.
 */
module.exports = (sequelize) => {
  RefreshToken.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'NULL para contas temporárias (temporary_users) — use temp_user_id nesses casos',
      },
      temp_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'temporary_users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        comment: 'Preenchido em vez de user_id quando o token pertence a uma TemporaryUser',
      },
      jti: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      revoked_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'RefreshToken',
      tableName: 'refresh_tokens',
      paranoid: false,
      indexes: [
        { fields: ['user_id'] },
        {
          name: 'rt_temp_user_id_idx',
          fields: ['temp_user_id'],
          where: sequelize.literal('"temp_user_id" IS NOT NULL'),
        },
        { fields: ['expires_at'] },
        { unique: true, fields: ['jti'] },
      ],
    }
  );

  return RefreshToken;
};
