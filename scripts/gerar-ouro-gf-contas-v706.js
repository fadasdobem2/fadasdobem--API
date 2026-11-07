'use strict';

/**
 * Gera o OURO das contas da v706 (convite, e-mail do Fadas, senha de 15, permissão "Ver minutagem total", quem pode entrar) a partir do
 * CÓDIGO REAL do front, em scripts/apoio-gf-contas-v706/ouro.json:
 *   node scripts/gerar-ouro-gf-contas-v706.js --front=<pasta do front com node_modules>
 * Roda: isFadasEmail, createDemoInvitation, resolveDemoInvitation, redeemDemoInvitation, revokeDemoInvitation (features/auth/demo-invitations.ts),
 * strongAccountPassword (demo-credentials.ts), accountCanEnter/accountRegistrationActive (account-access.ts), setDailyMinutesPermission,
 * validAccountPermissions, assertAccountPermissionWrite (account-permissions.ts) e permissionsFor (domain/permissions.ts). Nada do front é alterado.
 * Tudo fictício; o relógio é fixo e o token vem do próprio front.
 */

const fs = require('fs');
const path = require('path');
const { abrir } = require('./apoio-gf-regras-b/front');
const { montar } = require('./apoio-gf-contas-v706/cenarios');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);

(async () => {
  if (!arg('front')) { console.error('Informe --front=<pasta do front com node_modules>'); process.exit(2); }
  const ctx = await abrir(arg('front'));
  try {
    const front = {
      conv: await ctx.carregar('/features/auth/demo-invitations.ts'),
      cred: await ctx.carregar('/features/auth/demo-credentials.ts'),
      acesso: await ctx.carregar('/features/auth/account-access.ts'),
      perm: await ctx.carregar('/features/auth/account-permissions.ts'),
      papeis: await ctx.carregar('/features/domain/permissions.ts'),
    };
    const ouro = await montar(front);
    fs.writeFileSync(path.join(__dirname, 'apoio-gf-contas-v706', 'ouro.json'), `${JSON.stringify({ gerado: 'a partir do código do front v706 (auth/demo-invitations, demo-credentials, account-access, account-permissions, domain/permissions)', ...ouro })}\n`);
    console.log(Object.entries(ouro).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k}: ${v.length}`).join(' | '));
  } finally { await ctx.fechar(); }
})().catch((e) => { console.error(e); process.exit(2); });
