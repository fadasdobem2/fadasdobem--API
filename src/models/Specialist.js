const { Model, DataTypes } = require('sequelize');

const STATUSES = ['ONLINE', 'EM_ATENDIMENTO', 'AUSENTE', 'OFFLINE'];
const PIX_TYPES = ['EMAIL', 'CPF', 'CNPJ', 'TELEFONE', 'EVP'];
const REG_APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

const { hooksDeEstrutura } = require('./_estrutura-pg');

class Specialist extends Model {}

module.exports = (sequelize) => {
  Specialist.init(
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
      bio: { type: DataTypes.TEXT, allowNull: true },
      avatar_url: { type: DataTypes.STRING(512), allowNull: true },
      cover_image_url: { type: DataTypes.STRING(512), allowNull: true },
      chave_pix: { type: DataTypes.STRING(256), allowNull: true },
      chave_pix_type: { type: DataTypes.ENUM(...PIX_TYPES), allowNull: true },
      titular_pix_nome: { type: DataTypes.STRING(160), allowNull: true },
      status: {
        type: DataTypes.ENUM(...STATUSES),
        allowNull: false,
        defaultValue: 'OFFLINE',
      },
      reserved_by_client_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Trava anti-corrida: cliente que reservou a especialista no checkout',
      },
      reserved_until: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Janela curta (~8min) para concluir pagamento/atribuição',
      },
      experience_years: {
        type: DataTypes.SMALLINT,
        allowNull: true,
        comment: 'Anos de experiência informados pela profissional (vitrine)',
      },
      greeting_audio_url: {
        type: DataTypes.STRING(1024),
        allowNull: true,
        comment: 'URL (CDN/signed) do áudio de boas-vindas na vitrine',
      },
      presentation_video_url: {
        type: DataTypes.STRING(1024),
        allowNull: true,
        comment: 'URL do vídeo de apresentação na vitrine',
      },
      /** IANA; horários da agenda semanal são wall-clock neste fuso (`specialist_schedules`). */
      timezone: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: 'America/Sao_Paulo',
        comment: 'IANA; horários em specialist_schedules são wall-clock neste fuso',
      },
      rating_average_cached: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: true,
        comment: 'Média 1-5 recalculada por job',
      },
      reviews_count_cached: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      sessions_completed_cached: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      vitrine_ordem: { type: DataTypes.INTEGER, allowNull: true },
      accepts_queue_any: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: 'Aceita fila sem especialista pré-selecionada',
      },
      commission_percent_default: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: true,
        comment: 'Percentual padrão de comissão (sobrescrito por contrato/Nível gestor)',
      },
      agora_uid: { type: DataTypes.STRING(128), allowNull: true },
      intelbras_ramal: { type: DataTypes.STRING(32), allowNull: true },
      chatwoot_inbox_id: { type: DataTypes.STRING(64), allowNull: true },
      is_blocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      blocked_reason: { type: DataTypes.TEXT, allowNull: true },
      registration_approval_status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'APPROVED',
        validate: {
          isIn: {
            args: [REG_APPROVAL_STATUSES],
            msg: 'registration_approval_status inválido.',
          },
        },
        comment:
          'Workflow cadastro Gestora: PENDING aguardando homologação, APPROVED ativo conforme vínculo `users`, REJECTED recusado.',
      },
      registration_reviewed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      rank_boost_multiplier: {
        type: DataTypes.DECIMAL(10, 4),
        allowNull: false,
        defaultValue: 1.0,
        comment: 'Factor manual multiplicativo na ordenação editorial da vitrine (≥ 1.0 típico).',
      },
      slug: {
        type: DataTypes.STRING(160),
        allowNull: true,
        comment: 'Slug público na vitrine (único entre registos activos).',
      },
      candidate_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Origem no funil specialist_candidates (nullable após merge legado).',
      },
    },
    {
      sequelize,
      modelName: 'Specialist',
      tableName: 'specialists',
      hooks: hooksDeEstrutura(sequelize, 'specialists', {
        checks: [
          {
            nome: 'specialists_registration_approval_status_chk',
            sql: "registration_approval_status IN ('PENDING', 'APPROVED', 'REJECTED')",
          },
        ],
      }),
      paranoid: true,
      indexes: [
        {
          unique: true,
          name: 'specialists_user_deleted_at_null_uidx',
          fields: ['user_id'],
          where: { deleted_at: null },
        },
        { fields: ['status'] },
        { fields: ['reserved_by_client_id'] },
        {
          unique: true,
          name: 'specialists_slug_deleted_at_null_uidx',
          fields: ['slug'],
          where: sequelize.literal('"deleted_at" IS NULL AND "slug" IS NOT NULL'),
        },
        {
          name: 'specialists_candidate_id_idx',
          fields: ['candidate_id'],
          where: sequelize.literal('"candidate_id" IS NOT NULL AND "deleted_at" IS NULL'),
        },
      ],
    }
  );

  Specialist.STATUSES = STATUSES;
  Specialist.PIX_TYPES = PIX_TYPES;
  Specialist.REG_APPROVAL_STATUSES = REG_APPROVAL_STATUSES;
  return Specialist;
};
