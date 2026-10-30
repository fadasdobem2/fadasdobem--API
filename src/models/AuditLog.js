const { Model, DataTypes } = require('sequelize');

class AuditLog extends Model {}

module.exports = (sequelize) => {
  AuditLog.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      admin_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Gestor que executou a ação; null em eventos de segurança do próprio cliente (Auth)',
      },
      action: {
        type: DataTypes.STRING(120),
        allowNull: false,
        comment: 'Identificador curto (“UPDATE_PRICING_LEVEL”, “BLOCK_USER”)',
      },
      target_entity: {
        type: DataTypes.STRING(80),
        allowNull: false,
        comment: 'Nome lógico da tabela/domínio (User, PricingLevel…)',
      },
      target_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Chave quando aplicável — entidades não-UUID podem ir em metadata',
      },
      old_value: { type: DataTypes.JSONB, allowNull: true },
      new_value: { type: DataTypes.JSONB, allowNull: true },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Contexto extra (filtros aplicados, justificativa curta)',
      },
      ip_address: { type: DataTypes.STRING(45), allowNull: true },
      user_agent: { type: DataTypes.TEXT, allowNull: true },
      correlation_id: { type: DataTypes.STRING(64), allowNull: true },
      occurred_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: 'AuditLog',
      tableName: 'audit_logs',
      paranoid: false,
      timestamps: false,
      indexes: [
        { fields: ['admin_id'] },
        { fields: ['target_entity', 'target_id'] },
        { fields: ['action'] },
        { fields: ['occurred_at'] },
      ],
    }
  );

  return AuditLog;
};
