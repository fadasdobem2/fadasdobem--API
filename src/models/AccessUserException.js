const { Model, DataTypes } = require('sequelize');

class AccessUserException extends Model {}

module.exports = (sequelize) => {
  AccessUserException.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      user_id: { type: DataTypes.UUID, allowNull: false, onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
      permission_id: { type: DataTypes.UUID, allowNull: false, onDelete: 'CASCADE', onUpdate: 'NO ACTION' },
      granted: { type: DataTypes.BOOLEAN, allowNull: false },
      motivo: { type: DataTypes.TEXT, allowNull: false },
      author_id: { type: DataTypes.UUID, allowNull: false, onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
    },
    {
      sequelize,
      modelName: 'AccessUserException',
      tableName: 'access_user_exceptions',
      paranoid: true,
      indexes: [
        {
          unique: true,
          name: 'access_user_exceptions_user_perm_uidx',
          fields: ['user_id', 'permission_id'],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
      ],
    }
  );
  return AccessUserException;
};
