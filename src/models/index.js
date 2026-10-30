const { sequelize } = require('../config/database');

const User = require('./User')(sequelize);
const OAuthAccount = require('./OAuthAccount')(sequelize);
const UserDevice = require('./UserDevice')(sequelize);
const StaffProfile = require('./StaffProfile')(sequelize);
const Oracle = require('./Oracle')(sequelize);
const PricingLevel = require('./PricingLevel')(sequelize);
const Client = require('./Client')(sequelize);
const ClientDiary = require('./ClientDiary')(sequelize);
const Specialist = require('./Specialist')(sequelize);
const SpecialistModality = require('./SpecialistModality')(sequelize);
const SpecialistOracle = require('./SpecialistOracle')(sequelize);
const SpecialistSchedule = require('./SpecialistSchedule')(sequelize);
const SpecialistStatusLog = require('./SpecialistStatusLog')(sequelize);
const LedgerAccount = require('./LedgerAccount')(sequelize);
const TransactionLedger = require('./TransactionLedger')(sequelize);
const ClientCreditLot = require('./ClientCreditLot')(sequelize);
const PaymentOrder = require('./PaymentOrder')(sequelize);
const PendingDelivery = require('./PendingDelivery')(sequelize);
const PayoutRequest = require('./PayoutRequest')(sequelize);
const Queue = require('./Queue')(sequelize);
const Session = require('./Session')(sequelize);
const Review = require('./Review')(sequelize);
const OTP = require('./OTP')(sequelize);
const RefreshToken = require('./RefreshToken')(sequelize);
const AuditLog = require('./AuditLog')(sequelize);
const PlatformIntegration = require('./PlatformIntegration')(sequelize);
const Lead = require('./Lead')(sequelize);
const BotConversationFlowState = require('./BotConversationFlowState')(sequelize);
const AccountRecoveryRequest = require('./AccountRecoveryRequest')(sequelize);
const AccountRecoveryMessage = require('./AccountRecoveryMessage')(sequelize);
const TemporaryUser = require('./TemporaryUser')(sequelize);
const TemporaryClient = require('./TemporaryClient')(sequelize);
const SpecialistCandidate = require('./SpecialistCandidate')(sequelize);
const SpecialistPrivateProfile = require('./SpecialistPrivateProfile')(sequelize);
const JobApplication = require('./JobApplication')(sequelize);
const AccessPermission = require('./AccessPermission')(sequelize);
const AccessRole = require('./AccessRole')(sequelize);
const AccessDepartment = require('./AccessDepartment')(sequelize);
const AccessJobTitle = require('./AccessJobTitle')(sequelize);
const AccessUserException = require('./AccessUserException')(sequelize);
const AccessStaffInvite = require('./AccessStaffInvite')(sequelize);
require('./juncoes-access')(sequelize); // tabelas de junção do RBAC, antes das associações

/* --- Associações: autenticação e perfil --- */

User.hasMany(OAuthAccount, {
  foreignKey: 'user_id',
  as: 'oauth_accounts',
});

OAuthAccount.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

User.hasMany(UserDevice, {
  foreignKey: 'user_id',
  as: 'devices',
});

UserDevice.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

User.hasMany(OTP, {
  foreignKey: 'user_id',
  as: 'otps',
});

OTP.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

User.hasMany(RefreshToken, {
  foreignKey: 'user_id',
  as: 'refresh_tokens',
});

RefreshToken.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

User.hasOne(StaffProfile, {
  foreignKey: 'user_id',
  as: 'staff_profile',
});

StaffProfile.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

StaffProfile.belongsTo(AccessDepartment, {
  foreignKey: 'department_id',
  as: 'access_department',
});

StaffProfile.belongsTo(AccessJobTitle, {
  foreignKey: 'job_title_id',
  as: 'access_job_title',
});

AccessDepartment.hasMany(StaffProfile, {
  foreignKey: 'department_id',
  as: 'staff_members',
});

AccessJobTitle.hasMany(StaffProfile, {
  foreignKey: 'job_title_id',
  as: 'staff_members',
});

AccessRole.belongsToMany(AccessPermission, {
  through: 'access_role_permissions',
  // Tabela de junção (juncoes-access.js, só created_at) com FKs ON DELETE CASCADE / ON UPDATE NO ACTION (migração 20260706190000).
  onDelete: 'CASCADE',
  onUpdate: 'NO ACTION',
  foreignKey: 'role_id',
  otherKey: 'permission_id',
  as: 'permissions',
});

AccessPermission.belongsToMany(AccessRole, {
  through: 'access_role_permissions',
  // Tabela de junção (juncoes-access.js, só created_at) com FKs ON DELETE CASCADE / ON UPDATE NO ACTION (migração 20260706190000).
  onDelete: 'CASCADE',
  onUpdate: 'NO ACTION',
  foreignKey: 'permission_id',
  otherKey: 'role_id',
  as: 'roles',
});

AccessDepartment.belongsToMany(AccessPermission, {
  through: 'access_department_permissions',
  // Tabela de junção (juncoes-access.js, só created_at) com FKs ON DELETE CASCADE / ON UPDATE NO ACTION (migração 20260706190000).
  onDelete: 'CASCADE',
  onUpdate: 'NO ACTION',
  foreignKey: 'department_id',
  otherKey: 'permission_id',
  as: 'permissions',
});

AccessPermission.belongsToMany(AccessDepartment, {
  through: 'access_department_permissions',
  // Tabela de junção (juncoes-access.js, só created_at) com FKs ON DELETE CASCADE / ON UPDATE NO ACTION (migração 20260706190000).
  onDelete: 'CASCADE',
  onUpdate: 'NO ACTION',
  foreignKey: 'permission_id',
  otherKey: 'department_id',
  as: 'departments',
});

AccessJobTitle.belongsTo(AccessRole, {
  foreignKey: 'default_role_id',
  as: 'default_role',
});

User.belongsToMany(AccessRole, {
  through: 'access_user_roles',
  // Tabela de junção (juncoes-access.js, só created_at) com FKs ON DELETE CASCADE / ON UPDATE NO ACTION (migração 20260706190000).
  onDelete: 'CASCADE',
  onUpdate: 'NO ACTION',
  foreignKey: 'user_id',
  otherKey: 'role_id',
  as: 'access_roles',
});

AccessRole.belongsToMany(User, {
  through: 'access_user_roles',
  // Tabela de junção (juncoes-access.js, só created_at) com FKs ON DELETE CASCADE / ON UPDATE NO ACTION (migração 20260706190000).
  onDelete: 'CASCADE',
  onUpdate: 'NO ACTION',
  foreignKey: 'role_id',
  otherKey: 'user_id',
  as: 'users',
});

User.hasMany(AccessUserException, {
  foreignKey: 'user_id',
  as: 'access_exceptions',
});

AccessUserException.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

AccessUserException.belongsTo(User, {
  foreignKey: 'author_id',
  as: 'author',
});

AccessUserException.belongsTo(AccessPermission, {
  foreignKey: 'permission_id',
  as: 'permission',
});

User.hasMany(AccessStaffInvite, {
  foreignKey: 'invited_by_id',
  as: 'staff_invites_sent',
});

AccessStaffInvite.belongsTo(User, {
  foreignKey: 'invited_by_id',
  as: 'invited_by',
});

AccessStaffInvite.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

User.hasMany(AuditLog, {
  foreignKey: 'admin_id',
  as: 'audit_actions',
});

AuditLog.belongsTo(User, {
  foreignKey: 'admin_id',
  as: 'admin_user',
});

User.hasMany(PlatformIntegration, {
  foreignKey: 'configured_by_user_id',
  as: 'integrations_configured',
});

PlatformIntegration.belongsTo(User, {
  foreignKey: 'configured_by_user_id',
  as: 'configured_by_user',
});

/* --- Clientes e níveis --- */

User.hasOne(Client, {
  foreignKey: 'user_id',
  as: 'client_profile',
});

Client.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

PricingLevel.hasMany(Client, {
  foreignKey: 'pricing_level_id',
  as: 'clients',
});

Client.belongsTo(PricingLevel, {
  foreignKey: 'pricing_level_id',
  as: 'pricing_level',
});

Client.hasMany(ClientDiary, {
  foreignKey: 'client_id',
  as: 'private_diaries',
});

ClientDiary.belongsTo(Client, {
  foreignKey: 'client_id',
  as: 'client',
});

/* --- Especialistas, vitrine --- */

User.hasOne(Specialist, {
  foreignKey: 'user_id',
  as: 'specialist_profile',
});

Specialist.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

Specialist.belongsTo(Client, {
  foreignKey: 'reserved_by_client_id',
  as: 'reserved_by_client',
});

Client.hasMany(Specialist, {
  foreignKey: 'reserved_by_client_id',
  as: 'temporary_reservations_on_specialists',
});

Specialist.hasMany(SpecialistModality, {
  foreignKey: 'specialist_id',
  as: 'modalidades',
});

SpecialistModality.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

Oracle.belongsToMany(Specialist, {
  through: SpecialistOracle,
  foreignKey: 'oracle_id',
  otherKey: 'specialist_id',
  as: 'specialists',
});

Specialist.belongsToMany(Oracle, {
  through: SpecialistOracle,
  foreignKey: 'specialist_id',
  otherKey: 'oracle_id',
  as: 'oraculos_catalogo',
});

SpecialistOracle.belongsTo(Specialist, { foreignKey: 'specialist_id', as: 'specialist' });
SpecialistOracle.belongsTo(Oracle, { foreignKey: 'oracle_id', as: 'oracle' });

Specialist.hasMany(SpecialistSchedule, {
  foreignKey: 'specialist_id',
  as: 'agenda_horarios',
});

SpecialistSchedule.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

Specialist.hasOne(SpecialistPrivateProfile, {
  foreignKey: 'specialist_id',
  as: 'private_profile',
});

SpecialistPrivateProfile.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

Specialist.belongsTo(SpecialistCandidate, {
  foreignKey: 'candidate_id',
  as: 'origin_candidate',
});

SpecialistCandidate.hasOne(Specialist, {
  foreignKey: 'candidate_id',
  as: 'activated_specialist',
});

SpecialistCandidate.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

SpecialistCandidate.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

SpecialistCandidate.belongsTo(User, {
  foreignKey: 'created_by_user_id',
  as: 'created_by',
});

User.hasMany(SpecialistCandidate, {
  foreignKey: 'created_by_user_id',
  as: 'candidates_created',
});

Specialist.hasMany(SpecialistStatusLog, {
  foreignKey: 'specialist_id',
  as: 'historico_status',
});

SpecialistStatusLog.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

/** Trilho de SLA / disputas: mudanças de estado operacional. `Model.update(..., { where })` só dispara com `individualHooks: true`. */
Specialist.addHook('afterCreate', async (specialistInstance, opts) => {
  const st = specialistInstance.getDataValue('status');
  if (!st) return;
  try {
    await SpecialistStatusLog.create(
      {
        specialist_id: specialistInstance.id,
        previous_status: null,
        new_status: st,
        changed_at: new Date(),
      },
      { transaction: opts.transaction }
    );
  } catch (err) {
    console.error('[Specialist.afterCreate/status-log]', specialistInstance?.id, err?.message || err);
  }
});

Specialist.addHook('afterUpdate', async (specialistInstance, opts) => {
  const prev = specialistInstance.previous('status');
  const cur = specialistInstance.getDataValue('status');
  if ((prev ?? null) === (cur ?? null) || cur == null) return;
  try {
    await SpecialistStatusLog.create(
      {
        specialist_id: specialistInstance.id,
        previous_status: prev ?? null,
        new_status: cur,
        changed_at: new Date(),
      },
      { transaction: opts.transaction }
    );
  } catch (err) {
    console.error('[Specialist.afterUpdate/status-log]', specialistInstance?.id, err?.message || err);
  }
});

/* --- Contabilidade --- */

Client.hasMany(LedgerAccount, {
  foreignKey: 'client_id',
  as: 'ledger_accounts',
});

LedgerAccount.belongsTo(Client, {
  foreignKey: 'client_id',
  as: 'client',
});

Specialist.hasMany(LedgerAccount, {
  foreignKey: 'specialist_id',
  as: 'ledger_accounts',
});

LedgerAccount.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

TransactionLedger.belongsTo(LedgerAccount, {
  foreignKey: 'debit_account_id',
  as: 'debit_account',
});

TransactionLedger.belongsTo(LedgerAccount, {
  foreignKey: 'credit_account_id',
  as: 'credit_account',
});

LedgerAccount.hasMany(TransactionLedger, {
  foreignKey: 'debit_account_id',
  as: 'debits',
});

LedgerAccount.hasMany(TransactionLedger, {
  foreignKey: 'credit_account_id',
  as: 'credits',
});

TransactionLedger.belongsTo(User, {
  foreignKey: 'created_by_user_id',
  as: 'created_by_user',
});

User.hasMany(TransactionLedger, {
  foreignKey: 'created_by_user_id',
  as: 'ledger_entries_created',
});

/* --- Créditos e pagamentos --- */

Client.hasMany(ClientCreditLot, {
  foreignKey: 'client_id',
  as: 'credit_lotes',
});

ClientCreditLot.belongsTo(Client, {
  foreignKey: 'client_id',
  as: 'client',
});

PaymentOrder.hasMany(ClientCreditLot, {
  foreignKey: 'payment_order_id',
  as: 'credit_lotes',
});

ClientCreditLot.belongsTo(PaymentOrder, {
  foreignKey: 'payment_order_id',
  as: 'payment_order',
});

PaymentOrder.hasMany(PendingDelivery, {
  foreignKey: 'order_id',
  as: 'pending_deliveries',
});

PendingDelivery.belongsTo(PaymentOrder, {
  foreignKey: 'order_id',
  as: 'payment_order',
});

Client.hasMany(PaymentOrder, {
  foreignKey: 'client_id',
  as: 'payments',
});

PaymentOrder.belongsTo(Client, {
  foreignKey: 'client_id',
  as: 'client',
});

PaymentOrder.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'payer_user',
});

User.hasMany(PaymentOrder, {
  foreignKey: 'user_id',
  as: 'payments_as_payer',
});

/* --- Repasses --- */

Specialist.hasMany(PayoutRequest, {
  foreignKey: 'specialist_id',
  as: 'repasses',
});

PayoutRequest.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

PayoutRequest.belongsTo(User, {
  foreignKey: 'processed_by_user_id',
  as: 'processed_by',
});

User.hasMany(PayoutRequest, {
  foreignKey: 'processed_by_user_id',
  as: 'repasses_processed',
});

/* --- Fila e sessões --- */

Client.hasMany(Queue, {
  foreignKey: 'client_id',
  as: 'queues',
});

Queue.belongsTo(Client, {
  foreignKey: 'client_id',
  as: 'client',
});

Specialist.hasMany(Queue, {
  foreignKey: 'specialist_id',
  as: 'queues',
});

Queue.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

Client.hasMany(Session, {
  foreignKey: 'client_id',
  as: 'sessions',
});

Specialist.hasMany(Session, {
  foreignKey: 'specialist_id',
  as: 'sessions',
});

Session.belongsTo(Client, {
  foreignKey: 'client_id',
  as: 'client',
});

Session.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

Session.belongsTo(Queue, {
  foreignKey: 'queue_id',
  as: 'queue',
});

Queue.hasMany(Session, {
  foreignKey: 'queue_id',
  as: 'sessions',
});

Session.hasOne(Review, {
  foreignKey: 'session_id',
  as: 'review',
});

Review.belongsTo(Session, {
  foreignKey: 'session_id',
  as: 'session',
});

Review.belongsTo(Client, {
  foreignKey: 'client_id',
  as: 'client',
});

Client.hasMany(Review, {
  foreignKey: 'client_id',
  as: 'reviews_authored',
});

Review.belongsTo(Specialist, {
  foreignKey: 'specialist_id',
  as: 'specialist',
});

Specialist.hasMany(Review, {
  foreignKey: 'specialist_id',
  as: 'reviews',
});

Specialist.hasMany(Lead, {
  foreignKey: 'interested_specialist_id',
  as: 'agenda_leads_interested',
});

Lead.belongsTo(Specialist, {
  foreignKey: 'interested_specialist_id',
  as: 'interested_specialist',
});

/* --- TemporaryUser / TemporaryClient --- */

TemporaryUser.hasOne(TemporaryClient, {
  foreignKey: 'temp_user_id',
  as: 'client_profile',
});

TemporaryClient.belongsTo(TemporaryUser, {
  foreignKey: 'temp_user_id',
  as: 'temp_user',
});

TemporaryClient.belongsTo(PricingLevel, {
  foreignKey: 'pricing_level_id',
  as: 'pricing_level',
});

PricingLevel.hasMany(TemporaryClient, {
  foreignKey: 'pricing_level_id',
  as: 'temporary_clients',
});

/* --- Recuperação de conta / sincronização --- */

TemporaryUser.hasMany(AccountRecoveryRequest, {
  foreignKey: 'temp_account_id',
  as: 'account_recovery_requests',
});

AccountRecoveryRequest.belongsTo(TemporaryUser, {
  foreignKey: 'temp_account_id',
  as: 'temp_account',
});

AccountRecoveryRequest.belongsTo(User, {
  foreignKey: 'original_user_id',
  as: 'original_user',
});

AccountRecoveryRequest.belongsTo(User, {
  foreignKey: 'assigned_admin_id',
  as: 'assigned_admin',
});

User.hasMany(AccountRecoveryRequest, {
  foreignKey: 'assigned_admin_id',
  as: 'recovery_requests_assigned',
});

AccountRecoveryRequest.hasMany(AccountRecoveryMessage, {
  foreignKey: 'request_id',
  as: 'messages',
});

AccountRecoveryMessage.belongsTo(AccountRecoveryRequest, {
  foreignKey: 'request_id',
  as: 'recovery_request',
});

AccountRecoveryMessage.belongsTo(User, {
  foreignKey: 'sender_user_id',
  as: 'sender_user',
});

User.hasMany(AccountRecoveryMessage, {
  foreignKey: 'sender_user_id',
  as: 'recovery_messages_sent',
});

// Gestão Fadas: tabelas gf_* do banco novo (Postgres), registradas na conexão principal pelo próprio módulo.
const gestaoFadas = require('../gestao-fadas/novo/models').registrar(sequelize);

const db = {
  sequelize,
  ...gestaoFadas,
  User,
  OAuthAccount,
  UserDevice,
  StaffProfile,
  Oracle,
  PricingLevel,
  Client,
  ClientDiary,
  Specialist,
  SpecialistModality,
  SpecialistOracle,
  SpecialistSchedule,
  SpecialistStatusLog,
  LedgerAccount,
  TransactionLedger,
  ClientCreditLot,
  PaymentOrder,
  PendingDelivery,
  PayoutRequest,
  Queue,
  Session,
  Review,
  OTP,
  RefreshToken,
  AuditLog,
  PlatformIntegration,
  Lead,
  BotConversationFlowState,
  AccountRecoveryRequest,
  AccountRecoveryMessage,
  TemporaryUser,
  TemporaryClient,
  SpecialistCandidate,
  SpecialistPrivateProfile,
  JobApplication,
  AccessPermission,
  AccessRole,
  AccessDepartment,
  AccessJobTitle,
  AccessUserException,
  AccessStaffInvite,
};

module.exports = db;
