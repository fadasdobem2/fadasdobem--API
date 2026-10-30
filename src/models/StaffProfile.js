const { Model, DataTypes } = require('sequelize');

const { EnumPgNomeado, hooksDeEstrutura } = require('./_estrutura-pg');

const STAFF_STATUS = ['ativo', 'pendente', 'expirado', 'suspenso', 'desativado', 'bloqueado'];

class StaffProfile extends Model {}

module.exports = (sequelize) => {
  StaffProfile.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      display_name: { type: DataTypes.STRING(160), allowNull: true },
      department: { type: DataTypes.STRING(120), allowNull: true },
      department_id: { type: DataTypes.STRING(64), allowNull: true, onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
      job_title_id: { type: DataTypes.STRING(64), allowNull: true, onDelete: 'NO ACTION', onUpdate: 'NO ACTION' },
      staff_status: {
        type: EnumPgNomeado('enum_staff_status', STAFF_STATUS),
        allowNull: false,
        defaultValue: 'ativo',
      },
      must_change_password: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      avatar_gradient: { type: DataTypes.STRING(255), allowNull: true },
      avatar_initials: { type: DataTypes.STRING(8), allowNull: true },
      vinculo: { type: DataTypes.STRING(64), allowNull: true },
      personal_email: { type: DataTypes.STRING(320), allowNull: true },
      cpf: { type: DataTypes.STRING(20), allowNull: true },
      birth_date: { type: DataTypes.DATEONLY, allowNull: true },
      whatsapp: { type: DataTypes.STRING(32), allowNull: true },
      whatsapp2: { type: DataTypes.STRING(32), allowNull: true },
      address_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      payment_json: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      invited_at: { type: DataTypes.DATE, allowNull: true },
      first_login_at: { type: DataTypes.DATE, allowNull: true },
      internal_notes: { type: DataTypes.TEXT, allowNull: true },
      employee_code: { type: DataTypes.STRING(64), allowNull: true },
    },
    {
      sequelize,
      modelName: 'StaffProfile',
      tableName: 'staff_profiles',
      paranoid: true,
      hooks: hooksDeEstrutura(sequelize, 'staff_profiles', {
        enums: [{ nome: 'enum_staff_status', valores: STAFF_STATUS }],
      }),
      indexes: [
        {
          unique: true,
          name: 'staff_profiles_user_deleted_at_null_uidx',
          fields: ['user_id'],
          where: { deleted_at: null },
        },
        {
          name: 'staff_profiles_department_idx',
          fields: ['department_id'],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
        {
          name: 'staff_profiles_status_idx',
          fields: ['staff_status'],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
      ],
    }
  );

  return StaffProfile;
};
