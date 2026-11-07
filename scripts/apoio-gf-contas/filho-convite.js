'use strict';

/**
 * FILHO de scripts/verificar-gf-contas-convite.js (v706: convite, e-mail do Fadas, senha de 15, permissão "Ver minutagem total"). Derivado do
 * filho de contas: roda contra o Postgres DESCARTÁVEL (fdb_ctc_*) já migrado, com DB_* só no ambiente deste
 * processo. Prova pelo HTTP do gate (sessão de mentira, usuários reais da A no banco, tarólogos do legado SUBSTITUÍDOS por lista fixa:
 * o MySQL legado nem é configurado): contas (criar, editar, senha, bloquear, taróloga do catálogo), idempotência, 409, corrida,
 * perfis, última administradora, senha só como hash (banco, auditoria e gf_operacoes), sessões revogadas, escrita desligada,
 * flag desligada e Boas-vindas (leitura pública, editor, PUT com revisão, perfis, origem, tipo, auditoria).
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const bcrypt = require('bcryptjs');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

const ORIGEM = 'http://127.0.0.1:5180';
Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true',
  GF_FATIA_CONTAS: 'true', GF_FATIA_CADASTROS: 'true', GF_FATIA_CONFIG: 'true', FADAS_ORIGIN: ORIGEM, JWT_SECRET: process.env.JWT_SECRET || 'segredo-de-teste-local',
});
const r = (p) => path.join(raiz, p);
const SENHA = 'Teste!Fada#2026x'; // senha de teste do próprio filho, descartada com o banco
const SENHA2 = 'Outra!Senha#2026y';

const LEGADO = [{ idTarologo: 9001, nmuTarologo: 'Tarólogo A', ativo: 1 }, { idTarologo: 9003, nmuTarologo: 'Tarólogo C', ativo: 0 }];

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { User, AccessRole, RefreshToken } = require(r('src/models'));
  const { seedAccessCatalog } = require(r('src/rbac/rbac.seed'));
  await sequelize.authenticate();
  await seedAccessCatalog({});
  const tarologos = require(r('src/gestao-fadas/features/cadastros/tarologos.service'));
  tarologos.definirFonteLegado({ listar: async () => LEGADO.map((l) => ({ ...l })), obter: async (id) => LEGADO.find((l) => l.idTarologo === id) || null });
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const admin = await criarUsuario('Admin Contas');
  let sessao = { userId: admin, role: 'administradora', displayName: 'Admin Contas' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => (sessao ? { status: 'identity', identity: sessao, sessionId: 'sessao-ctc' } : { status: 'absent' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo, cab = {}) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json', ...(metodo === 'GET' ? {} : { origin: ORIGEM }), ...cab }, body: corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 300), h: resp.headers };
  };
  const como = (perfil, extra = {}) => { sessao = perfil ? { userId: admin, role: perfil, displayName: 'Teste', ...extra } : null; };
  const n = () => { n.i = (n.i || 0) + 1; return `op-${Date.now()}-${n.i}`; };
  const lerContas = async () => (await chamar('GET', '/accounts')).j;
  const achar = async (email) => (await lerContas()).accounts.find((a) => a.email === email);
  const um = async (sql) => (await sequelize.query(sql))[0];
  const criar = (extra = {}) => chamar('POST', '/accounts', { operationKey: n(), name: 'Pessoa Teste', email: `pessoa.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@fadasdobem.com.br`, role: 'atendente', password: SENHA, ...extra });

  const sha = (t) => require('crypto').createHash('sha256').update(t).digest('hex');
  const novoEmail = () => `conv.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@fadasdobem.com.br`;
  const publica = (p, corpo2) => { const ant = sessao; sessao = null; return chamar('POST', p, corpo2).finally(() => { sessao = ant; }); };
  const SEM_SENHA = { operationKey: undefined, name: 'Pessoa Convite', role: 'atendente' };
  const convidar = (extra = {}) => chamar('POST', '/accounts', { ...SEM_SENHA, operationKey: n(), email: novoEmail(), ...extra });
  const FORTE = 'Convite!Senha#2026z';

  console.log('Regras novas da v706 na criação');
  await passo('e-mail fora do Fadas: 422 com o texto do front; senha de 14 caracteres: 422 com 15 caracteres', async () => {
    const a = await convidar({ email: 'pessoa@exemplo.com' }); assert.equal(a.status, 422); assert.equal(a.j.error.message, 'Use o e-mail do Fadas (@fadasdobem.com.br)');
    const b = await criar({ password: 'Abcdefghijkl1!' }); assert.equal(b.status, 422); assert.equal(b.j.error.message, 'Use 15 caracteres, maiúscula, minúscula, número e símbolo. Confirme a mesma senha.');
    const c = await criar({ password: 'Abcdefghijklm1!' }); assert.equal(c.status, 200, c.t);
  });

  console.log('Convite de primeiro acesso');
  const k = n(); const email = novoEmail();
  const c1 = await chamar('POST', '/accounts', { ...SEM_SENHA, operationKey: k, email });
  let token = '';
  await passo('criar sem senha: conta nasce com Acesso pendente e convite de 48 horas; o token volta uma vez, 64 hexadecimais', async () => {
    assert.equal(c1.status, 200, c1.t);
    const a = c1.j.account; token = c1.j.invitation.token;
    assert.equal(a.access, 'Acesso pendente'); assert.equal(a.demoInvitation.kind, 'first-access'); assert.equal(a.demoInvitation.accountId, a.id);
    assert.match(token, /^[a-f0-9]{64}$/); assert.equal(a.demoInvitation.tokenHash, sha(token));
    assert.equal(Date.parse(a.demoInvitation.expiresAt) - Date.parse(a.demoInvitation.issuedAt), 48 * 3600 * 1000);
    assert.equal(c1.j.invitation.kind, 'first-access'); assert.ok(!a.demoInvitation.usedAt && !a.demoInvitation.revokedAt);
  });
  await passo('o token nunca é guardado: nem em gf_contas_ext, nem em gf_operacoes, nem na auditoria; só a impressão', async () => {
    for (const tabela of ['gf_contas_ext', 'gf_operacoes', 'gf_auditoria']) {
      const [l] = await sequelize.query(`SELECT count(*)::int AS n FROM ${tabela} t WHERE t::text LIKE '%${token}%'`);
      assert.equal(l[0].n, 0, tabela);
    }
    const [h] = await sequelize.query(`SELECT count(*)::int AS n FROM gf_contas_ext WHERE convite_hash = '${sha(token)}'`); assert.equal(h[0].n, 1);
  });
  await passo('a senha do usuário é um hash aleatório inutilizável (ninguém entra antes de definir a senha)', async () => {
    const [u] = await um(`SELECT password_hash FROM users WHERE id = '${c1.j.account.id}'`);
    assert.match(u.password_hash, /^\$2[aby]\$/); assert.equal(await bcrypt.compare(SENHA, u.password_hash), false); assert.equal(await bcrypt.compare(token, u.password_hash), false);
  });
  await passo('repetir a mesma operação devolve a mesma conta e o mesmo token sem criar outra', async () => {
    const r2 = await chamar('POST', '/accounts', { ...SEM_SENHA, operationKey: k, email });
    assert.equal(r2.status, 200); assert.equal(r2.j.invitation.token, token); assert.equal(r2.j.account.id, c1.j.account.id);
  });
  await passo('a lista mostra a conta com Acesso pendente e o convite', async () => {
    const a = await achar(email); assert.equal(a.access, 'Acesso pendente'); assert.equal(a.demoInvitation.tokenHash, sha(token));
  });

  console.log('Link público do convite (sem sessão)');
  await passo('resolver: válido mostra só nome, e-mail e tipo; token desconhecido = invalid; formato torto = 400', async () => {
    const v = await publica('/invitations/resolve', { token }); assert.equal(v.status, 200, v.t);
    assert.deepEqual(v.j, { status: 'valid', kind: 'first-access', account: { name: 'Pessoa Convite', email } });
    const i = await publica('/invitations/resolve', { token: 'a'.repeat(64) }); assert.equal(i.status, 200); assert.deepEqual(i.j, { status: 'invalid' });
    assert.equal((await publica('/invitations/resolve', { token: 'curto' })).status, 400);
    assert.equal((await publica('/invitations/resolve', { token, extra: 1 })).status, 400);
  });
  await passo('as rotas públicas: GET = 405, sem a Origem do front = 403, escrita desligada = 503', async () => {
    assert.equal((await chamar('GET', '/invitations/resolve')).status, 405);
    const ant = sessao; sessao = null;
    const sem = await fetch(`${base}/invitations/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) }); sessao = ant;
    assert.equal(sem.status, 403);
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
    try { assert.equal((await publica('/invitations/accept', { token, password: FORTE })).status, 503); } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
  });
  await passo('aceitar com senha de 14 caracteres: 422 (15 caracteres) e o convite continua valendo', async () => {
    const f = await publica('/invitations/accept', { token, password: 'Abcdefghijkl1!' }); assert.equal(f.status, 422);
    assert.equal(f.j.error.message, 'Use 15 caracteres, maiúscula, minúscula, número e símbolo. Confirme a mesma senha.');
    assert.equal((await publica('/invitations/resolve', { token })).j.status, 'valid');
  });
  await passo('aceitar com senha forte: senha vira hash, convite usado, acesso liberado, sessões revogadas; segunda vez = used', async () => {
    const id = c1.j.account.id;
    await RefreshToken.create({ user_id: id, token_hash: sha(`rt-${id}`), family_id: require('crypto').randomUUID(), expires_at: new Date(Date.now() + 3600e3) }).catch(() => null);
    const ok1 = await publica('/invitations/accept', { token, password: FORTE }); assert.equal(ok1.status, 200, ok1.t);
    assert.deepEqual(ok1.j, { status: 'accepted', account: { name: 'Pessoa Convite', email } });
    const [u] = await um(`SELECT password_hash FROM users WHERE id = '${id}'`);
    assert.equal(await bcrypt.compare(FORTE, u.password_hash), true);
    const a = await achar(email); assert.equal(a.access, 'Ainda não acessou'); assert.ok(a.demoInvitation.usedAt);
    const [rt] = await sequelize.query(`SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = '${id}' AND revoked_at IS NULL`); assert.equal(rt[0].n, 0);
    const de = await publica('/invitations/accept', { token, password: FORTE }); assert.deepEqual(de.j, { status: 'used' });
    assert.deepEqual((await publica('/invitations/resolve', { token })).j, { status: 'used' });
  });
  await passo('a senha não aparece em log nem na auditoria; a auditoria do aceite existe', async () => {
    const [l] = await sequelize.query(`SELECT count(*)::int AS n FROM gf_auditoria t WHERE t::text LIKE '%${FORTE}%'`); assert.equal(l[0].n, 0);
    const [a] = await sequelize.query("SELECT count(*)::int AS n FROM gf_auditoria WHERE acao = 'contas.convite.aceitar'"); assert.ok(a[0].n >= 1);
  });

  console.log('Gerar de novo, cancelar e invalidar');
  const alvo = c1.j.account.id;
  let rev = (await lerContas()).revisions[alvo];
  let t2 = '';
  await passo('nova senha: conta ativa recebe convite reset-password; gerar outro invalida o anterior', async () => {
    const a = await chamar('POST', `/accounts/${alvo}/invitation`, { operationKey: n(), expectedRevision: rev }); assert.equal(a.status, 200, a.t);
    assert.equal(a.j.invitation.kind, 'reset-password'); t2 = a.j.invitation.token; assert.equal(a.j.account.access, 'Ainda não acessou');
    assert.equal((await publica('/invitations/resolve', { token: t2 })).j.status, 'valid');
    rev = a.j.revision;
    const b = await chamar('POST', `/accounts/${alvo}/invitation`, { operationKey: n(), expectedRevision: rev }); assert.equal(b.status, 200);
    rev = b.j.revision;
    assert.deepEqual((await publica('/invitations/resolve', { token: t2 })).j, { status: 'invalid' });
    t2 = b.j.invitation.token;
  });
  await passo('a senha antiga continua valendo até a pessoa definir a nova (nova senha não bloqueia quem já tem acesso)', async () => {
    const [u] = await um(`SELECT password_hash FROM users WHERE id = '${alvo}'`); assert.equal(await bcrypt.compare(FORTE, u.password_hash), true);
  });
  await passo('revisão velha: 409 VERSION_CHANGED; conta inexistente 404; corpo com campo extra 400', async () => {
    const v = await chamar('POST', `/accounts/${alvo}/invitation`, { operationKey: n(), expectedRevision: 1 }); assert.equal(v.status, 409); assert.equal(v.j.error.code, 'VERSION_CHANGED');
    assert.equal((await chamar('POST', '/accounts/00000000-0000-4000-8000-000000000000/invitation', { operationKey: n(), expectedRevision: 1 })).status, 404);
    assert.equal((await chamar('POST', `/accounts/${alvo}/invitation`, { operationKey: n(), expectedRevision: rev, x: 1 })).status, 400);
  });
  await passo('cancelar convite: link vira revoked; cancelar de novo não muda nada', async () => {
    const c = await chamar('POST', `/accounts/${alvo}/invitation/cancel`, { operationKey: n(), expectedRevision: rev }); assert.equal(c.status, 200, c.t);
    assert.ok(c.j.account.demoInvitation.revokedAt); rev = c.j.revision;
    assert.deepEqual((await publica('/invitations/resolve', { token: t2 })).j, { status: 'revoked' });
    assert.deepEqual((await publica('/invitations/accept', { token: t2, password: SENHA2 })).j, { status: 'revoked' });
    const [u] = await um(`SELECT password_hash FROM users WHERE id = '${alvo}'`); assert.equal(await bcrypt.compare(FORTE, u.password_hash), true);
  });
  await passo('trocar e-mail ou função revoga o convite aberto; bloquear e reativar também', async () => {
    const g = await chamar('POST', `/accounts/${alvo}/invitation`, { operationKey: n(), expectedRevision: rev }); rev = g.j.revision; const tg = g.j.invitation.token;
    const e = await chamar('PATCH', `/accounts/${alvo}`, { operationKey: n(), expectedRevision: rev, email: novoEmail() }); assert.equal(e.status, 200, e.t); rev = e.j.revision;
    assert.deepEqual((await publica('/invitations/resolve', { token: tg })).j, { status: 'changed' }); // e-mail mudou: "changed" vem antes de "revoked" (ordem do front)
    const g2 = await chamar('POST', `/accounts/${alvo}/invitation`, { operationKey: n(), expectedRevision: rev }); rev = g2.j.revision; const tg2 = g2.j.invitation.token;
    const p = await chamar('PATCH', `/accounts/${alvo}`, { operationKey: n(), expectedRevision: rev, role: 'supervisora' }); assert.equal(p.status, 200, p.t); rev = p.j.revision;
    assert.deepEqual((await publica('/invitations/resolve', { token: tg2 })).j, { status: 'changed' });
    const [rv] = await sequelize.query(`SELECT count(*)::int AS n FROM gf_contas_ext WHERE user_id = '${alvo}' AND convite_revogado IS NOT NULL`); assert.equal(rv[0].n, 1); // a revogação também ficou gravada
    const g3 = await chamar('POST', `/accounts/${alvo}/invitation`, { operationKey: n(), expectedRevision: rev }); rev = g3.j.revision; const tg3 = g3.j.invitation.token;
    const b = await chamar('POST', `/accounts/${alvo}/active`, { operationKey: n(), expectedRevision: rev, active: false }); assert.equal(b.status, 200, b.t); rev = b.j.revision;
    assert.deepEqual((await publica('/invitations/resolve', { token: tg3 })).j, { status: 'revoked' });
    const bloq = await chamar('POST', `/accounts/${alvo}/invitation`, { operationKey: n(), expectedRevision: rev }); assert.equal(bloq.status, 422); assert.equal(bloq.j.error.message, 'Reative o acesso antes de gerar o convite.');
    const r2 = await chamar('POST', `/accounts/${alvo}/active`, { operationKey: n(), expectedRevision: rev, active: true }); rev = r2.j.revision;
  });
  await passo('convite vencido (48 horas) = expired; conta bloqueada que ainda tinha convite aberto = blocked só se o convite não foi revogado', async () => {
    const g = await chamar('POST', `/accounts/${alvo}/invitation`, { operationKey: n(), expectedRevision: rev }); rev = g.j.revision; const tg = g.j.invitation.token;
    await sequelize.query(`UPDATE gf_contas_ext SET convite_emitido = now() - interval '3 days', convite_expira = now() - interval '1 day' WHERE user_id = '${alvo}'`);
    assert.deepEqual((await publica('/invitations/resolve', { token: tg })).j, { status: 'expired' });
    assert.deepEqual((await publica('/invitations/accept', { token: tg, password: FORTE })).j, { status: 'expired' });
    await sequelize.query(`UPDATE gf_contas_ext SET convite_emitido = now(), convite_expira = now() + interval '2 days', convite_revogado = NULL WHERE user_id = '${alvo}'`);
    await sequelize.query(`UPDATE users SET is_active = false WHERE id = '${alvo}'`);
    assert.deepEqual((await publica('/invitations/resolve', { token: tg })).j, { status: 'blocked' });
    await sequelize.query(`UPDATE users SET is_active = true WHERE id = '${alvo}'`);
  });
  await passo('só a administradora gera ou cancela convite; sem sessão 401; a flag desligada = 404 também nas rotas públicas', async () => {
    como('atendente');
    assert.equal((await chamar('POST', `/accounts/${alvo}/invitation`, { operationKey: n(), expectedRevision: rev })).status, 403);
    assert.equal((await chamar('POST', `/accounts/${alvo}/invitation/cancel`, { operationKey: n(), expectedRevision: rev })).status, 403);
    como(null); assert.equal((await chamar('POST', `/accounts/${alvo}/invitation`, { operationKey: n(), expectedRevision: rev })).status, 401);
    como('administradora');
    delete process.env.GF_FATIA_CONTAS;
    try { assert.equal((await publica('/invitations/resolve', { token })).status, 404); assert.equal((await chamar('POST', `/accounts/${alvo}/invitation`, {})).status, 404); } finally { process.env.GF_FATIA_CONTAS = 'true'; }
  });

  console.log('Permissão adicional "Ver minutagem total"');
  await passo('atendente e supervisora recebem a permissão pela administradora, com trilha; assistente e tarólogo não', async () => {
    const a = await convidar({ viewDailyMinutes: true }); assert.equal(a.status, 200, a.t);
    assert.deepEqual(a.j.account.permissions, { viewDailyMinutes: true }); assert.equal(a.j.account.permissionAudit.length, 1);
    const l = a.j.account.permissionAudit[0];
    assert.equal(l.permission, 'viewDailyMinutes'); assert.equal(l.before, false); assert.equal(l.after, true); assert.equal(l.actorId, admin); assert.equal(l.actorRole, 'administradora');
    const s = await convidar({ role: 'supervisora', viewDailyMinutes: true }); assert.deepEqual(s.j.account.permissions, { viewDailyMinutes: true });
    const as = await convidar({ role: 'assistente', viewDailyMinutes: true }); assert.equal(as.status, 200); assert.ok(!as.j.account.permissions && !as.j.account.permissionAudit);
    const off = await convidar({ viewDailyMinutes: false }); assert.ok(!off.j.account.permissions && !off.j.account.permissionAudit);
  });
  await passo('desligar pelo PATCH grava a segunda linha da trilha; repetir o mesmo valor não grava; valor torto = 400', async () => {
    const a = await convidar({ viewDailyMinutes: true }); const id = a.j.account.id;
    const off = await chamar('PATCH', `/accounts/${id}`, { operationKey: n(), expectedRevision: a.j.revision, viewDailyMinutes: false }); assert.equal(off.status, 200, off.t);
    assert.ok(!off.j.account.permissions); assert.equal(off.j.account.permissionAudit.length, 2); assert.equal(off.j.account.permissionAudit[1].after, false);
    const igual = await chamar('PATCH', `/accounts/${id}`, { operationKey: n(), expectedRevision: off.j.revision, viewDailyMinutes: false }); assert.equal(igual.j.account.permissionAudit.length, 2);
    assert.equal((await chamar('PATCH', `/accounts/${id}`, { operationKey: n(), expectedRevision: igual.j.revision, viewDailyMinutes: 'sim' })).status, 400);
  });
  await passo('tarologa do catálogo recebe convite e a permissão não vale para ela', async () => {
    const t = await chamar('POST', '/accounts', { operationKey: n(), name: 'Tarólogo A', email: novoEmail(), role: 'tarologa', tarotId: '9001', viewDailyMinutes: true });
    assert.equal(t.status, 200, t.t); assert.equal(t.j.account.access, 'Acesso pendente'); assert.ok(!t.j.account.permissions); assert.equal(t.j.account.demoInvitation.role, 'tarologa');
  });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres descartável: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close().catch(() => {});
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
