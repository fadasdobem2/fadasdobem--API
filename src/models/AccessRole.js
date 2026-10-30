const { Model, DataTypes } = require('sequelize');

class AccessRole extends Model {}

module.exports = (sequelize) => {
  AccessRole.init(
    {
      id: { type: DataTypes.STRING(64), primaryKey: true },
      nome: { type: DataTypes.STRING(160), allowNull: false },
      descricao: { type: DataTypes.TEXT, allowNull: true },
      icone: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'ph-user-gear' },
      cor_gradient: { type: DataTypes.STRING(255), allowNull: true },
      all_access: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      sistema: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      sequelize,
      modelName: 'AccessRole',
      tableName: 'access_roles',
      paranoid: true,
    }
  );
  return AccessRole;
};
