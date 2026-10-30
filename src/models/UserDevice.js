const { Model, DataTypes } = require('sequelize');

const PLATFORMS = ['IOS', 'ANDROID', 'WEB'];

class UserDevice extends Model {}

module.exports = (sequelize) => {
  UserDevice.init(
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
      push_token: {
        type: DataTypes.STRING(512),
        allowNull: true,
        comment:
          'FCM/APNs; null ou token sintético `web:+hash` quando só registo WEB (sessão navegador)',
      },
      platform: {
        type: DataTypes.ENUM(...PLATFORMS),
        allowNull: false,
      },
      device_name: { type: DataTypes.STRING(128), allowNull: true },
      app_version: { type: DataTypes.STRING(32), allowNull: true },
      last_seen_at: { type: DataTypes.DATE, allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      sequelize,
      modelName: 'UserDevice',
      tableName: 'user_devices',
      paranoid: true,
      indexes: [
        { fields: ['user_id'] },
        { fields: ['push_token'] },
      ],
    }
  );

  UserDevice.PLATFORMS = PLATFORMS;
  return UserDevice;
};
