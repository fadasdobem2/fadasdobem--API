const { Model, DataTypes } = require('sequelize');

class SpecialistPrivateProfile extends Model {}

module.exports = (sequelize) => {
  SpecialistPrivateProfile.init(
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
      nome_civil: { type: DataTypes.STRING(160), allowNull: true },
      cpf: { type: DataTypes.STRING(14), allowNull: true },
      rg: { type: DataTypes.STRING(32), allowNull: true },
      data_nascimento: { type: DataTypes.DATEONLY, allowNull: true },
      endereco: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      contato_emergencia: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      dados_bancarios: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      contrato_url: { type: DataTypes.STRING(512), allowNull: true },
      contrato_assinado_em: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: 'SpecialistPrivateProfile',
      tableName: 'specialist_private_profiles',
      paranoid: true,
      indexes: [
        {
          unique: true,
          name: 'spp_specialist_id_uidx',
          fields: ['specialist_id'],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
        {
          unique: true,
          name: 'spp_cpf_uidx',
          fields: ['cpf'],
          where: sequelize.literal('"deleted_at" IS NULL AND "cpf" IS NOT NULL'),
        },
      ],
    }
  );

  return SpecialistPrivateProfile;
};
