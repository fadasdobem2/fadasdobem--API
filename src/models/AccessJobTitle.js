const { Model, DataTypes } = require('sequelize');

class AccessJobTitle extends Model {}

module.exports = (sequelize) => {
  AccessJobTitle.init(
    {
      id: { type: DataTypes.STRING(64), primaryKey: true },
      nome: { type: DataTypes.STRING(160), allowNull: false },
      descricao: { type: DataTypes.TEXT, allowNull: true },
      default_role_id: {
        type: DataTypes.STRING(64),
        allowNull: false,
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
      icone: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'ph-identification-badge' },
      cor: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'v-gold' },
      ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      sequelize,
      modelName: 'AccessJobTitle',
      tableName: 'access_job_titles',
      paranoid: true,
    }
  );
  return AccessJobTitle;
};
