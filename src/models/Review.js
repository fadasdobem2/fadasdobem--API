const { Model, DataTypes } = require('sequelize');

class Review extends Model {}

module.exports = (sequelize) => {
  Review.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      session_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      client_id: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: 'Autora da avaliação',
      },
      specialist_id: {
        type: DataTypes.UUID,
        allowNull: false,
        comment: 'Desnormalizado para relatórios da taróloga sem join extra',
      },
      rating: {
        type: DataTypes.SMALLINT,
        allowNull: false,
        validate: {
          min: 1,
          max: 5,
        },
      },
      comment: { type: DataTypes.TEXT, allowNull: true },
      is_public: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      moderated_by_user_id: { type: DataTypes.UUID, allowNull: true },
      moderated_at: { type: DataTypes.DATE, allowNull: true },
      moderation_note: { type: DataTypes.TEXT, allowNull: true },
      temp_client_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'temporary_clients', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
    },
    {
      sequelize,
      modelName: 'Review',
      tableName: 'reviews',
      paranoid: true,
      indexes: [
        {
          unique: true,
          name: 'reviews_session_deleted_null_uidx',
          fields: ['session_id'],
          where: { deleted_at: null },
        },
        { fields: ['specialist_id'] },
        { fields: ['client_id'] },
        {
          name: 'reviews_temp_client_id_idx',
          fields: ['temp_client_id'],
          where: sequelize.literal('"temp_client_id" IS NOT NULL'),
        },
      ],
    }
  );

  return Review;
};
