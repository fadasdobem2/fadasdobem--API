/**
 * Seed idempotente do catálogo RBAC (papéis, setores, cargos, permissões).
 *
 * Uso: `npm run seed:access`
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sequelize } = require('../src/config/database');
require('../src/models');

const { User } = require('../src/models');
const { seedAccessCatalog } = require('../src/rbac/rbac.seed');

const GESTORA_EMAIL = `${process.env.SEED_GESTORA_EMAIL || 'laya@fadasdobem.test'}`.trim().toLowerCase();

async function resolveGestoraUserId() {
  const fromEnv = `${process.env.SEED_GESTORA_USER_ID || ''}`.trim();
  if (fromEnv) return fromEnv;

  const user = await User.findOne({ where: { email: GESTORA_EMAIL }, paranoid: true });
  if (!user) {
    console.warn('[seed:access] gestora não encontrada — catálogo sem assign admin.');
    return null;
  }
  return user.id;
}

async function main() {
  await sequelize.authenticate();
  const gestoraUserId = await resolveGestoraUserId();
  await seedAccessCatalog({ gestoraUserId });
  console.log('[seed:access] OK');
  if (gestoraUserId) console.log('  admin role assigned to:', gestoraUserId);
  await sequelize.close();
}

main().catch((err) => {
  console.error('[seed:access] falha:', err);
  process.exit(1);
});
