const { Model, DataTypes } = require('sequelize');

const QUEUE_STATUSES = [
  'WAITING',
  'MATCHED',
  'INVITED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_SYSTEM',
  'EXPIRED',
  'ABANDONED',
];

class Queue extends Model {}

module.exports = (sequelize) => {
  Queue.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      client_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      specialist_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...QUEUE_STATUSES),
        allowNull: false,
        defaultValue: 'WAITING',
      },
      joined_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      left_at: { type: DataTypes.DATE, allowNull: true },
      preferred_modality: {
        type: DataTypes.ENUM('TEXTO', 'VOZ', 'VIDEO'),
        allowNull: true,
      },
      priority_score: {
        type: DataTypes.SMALLINT,
        allowNull: true,
        comment: 'Desempate de fila (VIP, campanha)',
      },
      metadata: { type: DataTypes.JSONB, allowNull: true },
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
      modelName: 'Queue',
      tableName: 'queues',
      paranoid: true,
      indexes: [
        { fields: ['client_id'] },
        { fields: ['specialist_id'] },
        { fields: ['status'] },
        {
          name: 'queues_temp_client_id_idx',
          fields: ['temp_client_id'],
          where: sequelize.literal('"temp_client_id" IS NOT NULL'),
        },
      ],
    }
  );

  Queue.QUEUE_STATUSES = QUEUE_STATUSES;
  return Queue;
};
