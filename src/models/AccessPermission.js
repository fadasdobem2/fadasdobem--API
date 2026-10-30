const { Model, DataTypes } = require('sequelize');

const { EnumPgNomeado, hooksDeEstrutura } = require('./_estrutura-pg');

const NIVEIS = ['baixo', 'medio', 'alto', 'critico'];

class AccessPermission extends Model {}

module.exports = (sequelize) => {
  AccessPermission.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      chave: { type: DataTypes.STRING(120), allowNull: false },
      rotulo: { type: DataTypes.STRING(200), allowNull: false },
      descricao: { type: DataTypes.TEXT, allowNull: true },
      area: { type: DataTypes.STRING(64), allowNull: false },
      nivel: {
        type: EnumPgNomeado('enum_access_permission_level', NIVEIS),
        allowNull: false,
        defaultValue: 'baixo',
      },
      ativo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      custom: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      sequelize,
      modelName: 'AccessPermission',
      tableName: 'access_permissions',
      paranoid: true,
      hooks: hooksDeEstrutura(sequelize, 'access_permissions', {
        enums: [{ nome: 'enum_access_permission_level', valores: NIVEIS }],
      }),
      indexes: [
        {
          unique: true,
          name: 'access_permissions_chave_active_uidx',
          fields: ['chave'],
          where: sequelize.literal('"deleted_at" IS NULL'),
        },
      ],
    }
  );
  return AccessPermission;
};
