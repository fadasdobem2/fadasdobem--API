const { Model, DataTypes } = require('sequelize');

const DELIVERY_STATUSES = ['PENDING', 'SENT', 'FAILED'];

const { hooksDeEstrutura } = require('./_estrutura-pg');

class PendingDelivery extends Model {}

module.exports = (sequelize) => {
  PendingDelivery.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      order_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      payload: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      status: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'PENDING',
        validate: {
          isIn: {
            args: [DELIVERY_STATUSES],
            msg: `status deve ser um de ${DELIVERY_STATUSES.join(', ')}`,
          },
        },
      },
      attempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      last_error: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'PendingDelivery',
      tableName: 'pending_deliveries',
      paranoid: false,
      hooks: hooksDeEstrutura(sequelize, 'pending_deliveries', {
        checks: [{ nome: 'pending_deliveries_status_chk', sql: "status IN ('PENDING', 'SENT', 'FAILED')" }],
      }),
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { name: 'pending_deliveries_order_id_idx', fields: ['order_id'] },
        { name: 'pending_deliveries_status_idx', fields: ['status'] },
      ],
    }
  );

  PendingDelivery.STATUS = DELIVERY_STATUSES;
  return PendingDelivery;
};
