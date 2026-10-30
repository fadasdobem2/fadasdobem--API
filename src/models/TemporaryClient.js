const { Model, DataTypes } = require('sequelize');

class TemporaryClient extends Model {}

module.exports = (sequelize) => {
  TemporaryClient.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      temp_user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        // UNIQUE de coluna inteira (constraint) e FK RESTRICT, como na migração 20260618115000.
        unique: 'temporary_clients_temp_user_active_uidx',
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      nome_completo: { type: DataTypes.STRING(160), allowNull: true },
      nome_id: { type: DataTypes.STRING(160), allowNull: true },
      nome: { type: DataTypes.STRING(160), allowNull: true },
      apelido: { type: DataTypes.STRING(80), allowNull: true },
      tratar_por: { type: DataTypes.STRING(120), allowNull: true },
      data_nascimento: { type: DataTypes.DATEONLY, allowNull: true },
      cpf: { type: DataTypes.STRING(14), allowNull: true },
      pricing_level_id: { type: DataTypes.UUID, allowNull: true },
      internal_notes: { type: DataTypes.TEXT, allowNull: true },
      first_completed_session_at: { type: DataTypes.DATE, allowNull: true },
      loyalty_tier_cached: { type: DataTypes.STRING(64), allowNull: true },
    },
    {
      sequelize,
      modelName: 'TemporaryClient',
      tableName: 'temporary_clients',
      paranoid: true,
      hooks: {
        beforeValidate: (inst) => {
          try {
            const business = require('../config/business.config');
            const { deriveNomeIdFromNomeCompleto } = require('../utils/name.util');
            const full =
              `${inst.get('nome_completo') ?? ''}`.trim() || `${inst.get('nome') ?? ''}`.trim();
            if (!full) return;
            inst.set('nome_id', deriveNomeIdFromNomeCompleto(full, business.NAME_ID_GENERATION_LOGIC));
          } catch (_) {
            // graceful — hook não deve quebrar a criação
          }
        },
      },
      indexes: [
        { name: 'tc_pricing_level_idx', fields: ['pricing_level_id'] },
        { name: 'tc_temp_user_id_idx', fields: ['temp_user_id'] },
      ],
    }
  );

  return TemporaryClient;
};
