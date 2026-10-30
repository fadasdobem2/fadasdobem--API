const { Model, DataTypes } = require('sequelize');

class ClientDiary extends Model {}

module.exports = (sequelize) => {
  ClientDiary.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      client_id: {
        type: DataTypes.UUID,
        allowNull: false,
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      temp_client_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'temporary_clients', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      content: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      /** Coluna SQL `date`. */
      calendar_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        field: 'date',
      },
    },
    {
      sequelize,
      modelName: 'ClientDiary',
      tableName: 'client_diaries',
      paranoid: true,
      underscored: true,
      indexes: [
        {
          name: 'client_diaries_client_id_idx',
          fields: ['client_id'],
        },
        { name: 'client_diaries_date_idx', fields: ['date'] },
        {
          unique: true,
          name: 'client_diaries_client_date_active_uidx',
          fields: ['client_id', 'date'],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
        {
          name: 'client_diaries_temp_client_id_idx',
          fields: ['temp_client_id'],
          where: sequelize.literal('"temp_client_id" IS NOT NULL'),
        },
      ],
    }
  );

  return ClientDiary;
};
