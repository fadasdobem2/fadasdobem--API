const { Model, DataTypes } = require('sequelize');

const PURPOSES = [
  'RESET_PASSWORD',
  'EMAIL_VERIFY',
  'PHONE_VERIFY',
  'LOGIN_STEP_UP',
];

class OTP extends Model {}

module.exports = (sequelize) => {
  OTP.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      user_id: { type: DataTypes.UUID, allowNull: false },
      purpose: {
        type: DataTypes.ENUM(...PURPOSES),
        allowNull: false,
      },
      code: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment:
          'Em produção, armazene apenas hash ou use coluna paralela codificada — o serviço de auth deve atualizar política aqui.',
      },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      attempts_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      max_attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 5,
      },
      consumed_at: { type: DataTypes.DATE, allowNull: true },
      delivery_channel: {
        type: DataTypes.STRING(24),
        allowNull: true,
        comment: 'EMAIL, SMS, WHATSAPP, etc.',
      },
      locked_until: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      ip_address_created: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
      user_agent_created: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'OTP',
      tableName: 'otps',
      paranoid: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [{ fields: ['user_id'] }, { fields: ['expires_at'] }, { fields: ['purpose'] }],
    }
  );

  OTP.PURPOSES = PURPOSES;
  return OTP;
};
