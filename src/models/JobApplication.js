const { Model, DataTypes } = require('sequelize');

const ESTADOS = ['novo', 'em_analise', 'aprovado', 'reprovado', 'arquivado'];

class JobApplication extends Model {}

module.exports = (sequelize) => {
  JobApplication.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      categoria: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'outras_areas',
      },
      nome_completo: { type: DataTypes.STRING(160), allowNull: false },
      email: { type: DataTypes.STRING(320), allowNull: false },
      whatsapp: { type: DataTypes.STRING(32), allowNull: true },
      cidade: { type: DataTypes.STRING(120), allowNull: true },
      area_interesse: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      cargo_desejado: { type: DataTypes.STRING(160), allowNull: true },
      nivel: { type: DataTypes.STRING(64), allowNull: true },
      linkedin: { type: DataTypes.STRING(512), allowNull: true },
      portfolio_site: { type: DataTypes.STRING(512), allowNull: true },
      curriculo_url: { type: DataTypes.STRING(512), allowNull: true },
      curriculo_nome: { type: DataTypes.STRING(255), allowNull: true },
      apresentacao: { type: DataTypes.TEXT, allowNull: true },
      como_chegou: { type: DataTypes.TEXT, allowNull: true },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      estado: {
        type: DataTypes.ENUM(...ESTADOS),
        allowNull: false,
        defaultValue: 'novo',
      },
      chegou_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      decidida_em: { type: DataTypes.DATE, allowNull: true },
      razao: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'JobApplication',
      tableName: 'job_applications',
      paranoid: true,
      indexes: [
        {
          name: 'ja_estado_idx',
          fields: ['estado'],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
        {
          name: 'ja_email_lower_idx',
          fields: [sequelize.fn('lower', sequelize.col('email'))],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
        {
          name: 'ja_chegou_idx',
          fields: [{ name: 'chegou_em', order: 'DESC' }],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
      ],
    }
  );

  JobApplication.ESTADOS = ESTADOS;
  return JobApplication;
};
