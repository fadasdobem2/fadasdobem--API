const { Model, DataTypes } = require('sequelize');

class AccessDepartment extends Model {}

module.exports = (sequelize) => {
  AccessDepartment.init(
    {
      id: { type: DataTypes.STRING(64), primaryKey: true },
      nome: { type: DataTypes.STRING(160), allowNull: false },
      descricao: { type: DataTypes.TEXT, allowNull: true },
      icone: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'ph-squares-four' },
      cor: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'v-blue' },
      ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      sequelize,
      modelName: 'AccessDepartment',
      tableName: 'access_departments',
      paranoid: true,
    }
  );
  return AccessDepartment;
};
