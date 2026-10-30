const { Model, DataTypes } = require('sequelize');

const MODALITIES = ['TEXTO', 'VOZ', 'VIDEO'];

class SpecialistModality extends Model {}

module.exports = (sequelize) => {
  SpecialistModality.init(
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
      modality: {
        type: DataTypes.ENUM(...MODALITIES),
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'SpecialistModality',
      tableName: 'specialist_modalities',
      paranoid: true,
      indexes: [{ unique: true, fields: ['specialist_id', 'modality'] }],
    }
  );

  SpecialistModality.MODALITIES = MODALITIES;
  return SpecialistModality;
};
