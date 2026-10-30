const { Model, DataTypes } = require('sequelize');

const ESTADOS = ['nova', 'em_analise', 'aprovada', 'em_onboarding', 'reprovada', 'arquivada'];
const TRIAGENS = ['pendente', 'em_espera'];

class SpecialistCandidate extends Model {}

module.exports = (sequelize) => {
  SpecialistCandidate.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      apelido: { type: DataTypes.STRING(160), allowNull: false },
      nome_civil: { type: DataTypes.STRING(160), allowNull: true },
      email: { type: DataTypes.STRING(320), allowNull: true },
      whatsapp: { type: DataTypes.STRING(32), allowNull: true },
      origem: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'Site' },
      categoria: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'oraculista',
      },
      meta: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      estado: {
        type: DataTypes.ENUM(...ESTADOS),
        allowNull: false,
        defaultValue: 'nova',
      },
      triagem: {
        type: DataTypes.ENUM(...TRIAGENS),
        allowNull: true,
        defaultValue: 'pendente',
      },
      grad: { type: DataTypes.STRING(8), allowNull: true },
      idade: { type: DataTypes.SMALLINT, allowNull: true },
      chegou_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      decidida_em: { type: DataTypes.DATE, allowNull: true },
      razao: { type: DataTypes.TEXT, allowNull: true },
      espera_desde: { type: DataTypes.DATE, allowNull: true },
      espera_motivo: { type: DataTypes.STRING(64), allowNull: true },
      espera_nota: { type: DataTypes.TEXT, allowNull: true },
      f1: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      proc: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      convite: { type: DataTypes.JSONB, allowNull: true },
      onb: { type: DataTypes.JSONB, allowNull: true },
      f2: { type: DataTypes.JSONB, allowNull: true },
      f2_original: { type: DataTypes.JSONB, allowNull: true },
      onboarding_token: { type: DataTypes.STRING(64), allowNull: true },
      onboarding_token_expires_at: { type: DataTypes.DATE, allowNull: true },
      specialist_id: { type: DataTypes.UUID, allowNull: true },
      user_id: { type: DataTypes.UUID, allowNull: true },
      created_by_user_id: { type: DataTypes.UUID, allowNull: true },
    },
    {
      sequelize,
      modelName: 'SpecialistCandidate',
      tableName: 'specialist_candidates',
      paranoid: true,
      indexes: [
        {
          name: 'sc_estado_idx',
          fields: ['estado'],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
        {
          name: 'sc_triagem_idx',
          fields: ['triagem'],
          where: sequelize.literal(`"deleted_at" IS NULL AND "estado" = 'nova'`),
        },
        {
          name: 'sc_estado_chegou_idx',
          fields: ['estado', { name: 'chegou_em', order: 'DESC' }],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
        {
          name: 'sc_email_lower_idx',
          fields: [sequelize.fn('lower', sequelize.col('email'))],
          where: sequelize.literal('"deleted_at" IS NULL AND "email" IS NOT NULL'),
        },
        {
          name: 'sc_apelido_idx',
          fields: ['apelido'],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
        {
          unique: true,
          name: 'sc_onboarding_token_uidx',
          fields: ['onboarding_token'],
          where: sequelize.literal('"onboarding_token" IS NOT NULL AND "deleted_at" IS NULL'),
        },
        {
          name: 'sc_specialist_id_idx',
          fields: ['specialist_id'],
          where: sequelize.literal('"specialist_id" IS NOT NULL AND "deleted_at" IS NULL'),
        },
        {
          name: 'sc_categoria_idx',
          fields: ['categoria'],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
      ],
    }
  );

  SpecialistCandidate.ESTADOS = ESTADOS;
  SpecialistCandidate.TRIAGENS = TRIAGENS;
  return SpecialistCandidate;
};
