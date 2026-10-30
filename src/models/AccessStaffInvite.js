const { Model, DataTypes } = require('sequelize');

class AccessStaffInvite extends Model {}

module.exports = (sequelize) => {
  AccessStaffInvite.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      email: { type: DataTypes.STRING(320), allowNull: false },
      token_hash: { type: DataTypes.STRING(128), allowNull: false },
      user_id: { type: DataTypes.UUID, allowNull: true, onDelete: 'SET NULL', onUpdate: 'NO ACTION' },
      department_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
        references: { model: 'access_departments', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      job_title_id: {
        type: DataTypes.STRING(64),
        allowNull: true,
        references: { model: 'access_job_titles', key: 'id' },
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      role_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      accepted_at: { type: DataTypes.DATE, allowNull: true },
      invited_by_id: { type: DataTypes.UUID, allowNull: false, onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
    },
    {
      sequelize,
      modelName: 'AccessStaffInvite',
      tableName: 'access_staff_invites',
      timestamps: true,
      indexes: [
        { name: 'access_staff_invites_email_idx', fields: [sequelize.fn('lower', sequelize.col('email'))] },
      ],
    }
  );
  return AccessStaffInvite;
};
