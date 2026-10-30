'use strict';

/**
 * Cria no banco LOCAL da API as contas de teste (as do mock do front: administradora, assistente, supervisora,
 * atendente e tarólogas) para testar o login nativo do gate. Idempotente. Recusa banco que não seja de ensaio local.
 * A lista e a senha de teste ficam em `src/dev/contas-teste.js` (também mostradas na página `/dados-teste`).
 *   npm run api:local -- --cnf=<.cnf> --migrar    (usa o banco e as variáveis de .local-dev/api.env)
 */
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { SENHA_PADRAO, CONTAS, EMAILS_ANTIGOS } = require('../src/dev/contas-teste');

(async () => {
  if (!['127.0.0.1', 'localhost', '::1'].includes(`${process.env.DB_HOST || ''}`.trim())) throw new Error('Recusado: o banco não é local.');
  if (!/(integracao|local|teste)/i.test(`${process.env.DB_NAME || ''}`)) throw new Error(`Recusado: o banco ${process.env.DB_NAME} não parece de ensaio local (use npm run api:local -- --migrar).`);
  const { sequelize } = require('../src/config/database');
  const { User, AccessRole, StaffProfile, Specialist } = require('../src/models');
  const { seedAccessCatalog } = require('../src/rbac/rbac.seed');
  await sequelize.authenticate();
  await seedAccessCatalog({});
  const hash = await bcrypt.hash(SENHA_PADRAO, 10);

  for (const email of EMAILS_ANTIGOS) {
    const velho = await User.findOne({ where: { email } });
    if (velho) { await StaffProfile.destroy({ where: { user_id: velho.id } }); await velho.setAccess_roles([]); await velho.destroy(); console.log(`  removida conta genérica antiga ${email}`); }
  }

  for (const c of CONTAS) {
    let u = await User.findOne({ where: { email: c.email } });
    if (!u) u = await User.create({ email: c.email, password_hash: hash, role: c.produto, is_active: c.ativa, email_verified_at: new Date() });
    else await u.update({ password_hash: hash, role: c.produto, is_active: c.ativa, email_verified_at: u.email_verified_at || new Date() });
    await u.setAccess_roles(c.rbac.length ? await AccessRole.findAll({ where: { id: c.rbac } }) : []);
    if (c.perfil === 'tarologa') {
      if (!(await Specialist.findOne({ where: { user_id: u.id } }))) {
        await Specialist.create({ user_id: u.id, display_name: c.nome, slug: c.tarot, status: 'OFFLINE', commission_percent_default: c.comissao, registration_approval_status: 'APPROVED' });
      }
    } else if (!(await StaffProfile.findOne({ where: { user_id: u.id } }))) {
      await StaffProfile.create({ user_id: u.id, display_name: c.nome, staff_status: 'ativo' });
    }
    console.log(`  ok  ${c.email} (${c.perfil}${c.ativa ? '' : ', inativa'})`);
  }
  await sequelize.close();
  console.log(`${CONTAS.length} contas de teste prontas. Lista e senha: src/dev/contas-teste.js e http://127.0.0.1:4010/dados-teste`);
  process.exit(0); // o Redis do cache de permissões mantém o processo aberto
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
