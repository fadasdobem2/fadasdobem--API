const { Model, DataTypes } = require('sequelize');

class PricingLevel extends Model {}

module.exports = (sequelize) => {
  PricingLevel.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
        comment: 'Ex: Promocional 1ª consulta, Nível 1, VIP',
      },
      code: { type: DataTypes.STRING(64), allowNull: false },
      price_text_voice: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: false,
        comment: 'Preço por minuto — modalidades Texto e Voz (precisão BRL estrita)',
      },
      price_video: {
        type: DataTypes.DECIMAL(14, 4),
        allowNull: false,
        comment: 'Preço por minuto — Vídeo (Agora)',
      },
      is_first_consultation_only: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      valid_from: { type: DataTypes.DATE, allowNull: true },
      valid_until: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'PricingLevel',
      tableName: 'pricing_levels',
      paranoid: true,
      indexes: [
        {
          unique: true,
          name: 'pricing_levels_code_deleted_at_null_uidx',
          fields: ['code'],
          where: { deleted_at: null },
        },
      ],
    }
  );

  return PricingLevel;
};
