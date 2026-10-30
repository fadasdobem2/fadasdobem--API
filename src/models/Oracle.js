const { Model, DataTypes } = require('sequelize');

class Oracle extends Model {}

module.exports = (sequelize) => {
  Oracle.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: { type: DataTypes.STRING(120), allowNull: false },
      slug: { type: DataTypes.STRING(120), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      sequelize,
      modelName: 'Oracle',
      tableName: 'oracles',
      paranoid: true,
      indexes: [
        {
          unique: true,
          name: 'oracles_slug_deleted_at_null_uidx',
          fields: ['slug'],
          where: { deleted_at: null },
        },
      ],
    }
  );

  return Oracle;
};
