const { Model, DataTypes } = require('sequelize');

class SpecialistOracle extends Model {}

module.exports = (sequelize) => {
  SpecialistOracle.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      specialist_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      oracle_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      years_using: {
        type: DataTypes.SMALLINT,
        allowNull: true,
        comment: 'Opcional para vitrine (“10 anos com Tarô mitológico”)',
      },
    },
    {
      sequelize,
      modelName: 'SpecialistOracle',
      tableName: 'specialist_oracles',
      paranoid: true,
      indexes: [{ unique: true, fields: ['specialist_id', 'oracle_id'] }],
    }
  );

  return SpecialistOracle;
};
