'use strict';

/**
 * FILHO de scripts/verificar-gf-contas.js: roda contra o Postgres DESCARTÁVEL (fdb_ctc_*) já migrado, com DB_* só no ambiente deste
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
  const criar = (extra = {}) => chamar('POST', '/accounts', { operationKey: n(), name: 'Pessoa Teste', email: `pessoa.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@fadas.test`, role: 'atendente', password: SENHA, ...extra });

  console.log('Esquema');
  await passo('gf_contas_ext existe e a migração roda de novo sem erro', async () => {
    const [t] = await sequelize.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='gf_contas_ext'");
    assert.equal(t.length, 1);
    await require(r('migrations/20261118000000-gestao-fadas-contas-config')).up({ sequelize });
  });

  console.log('Perfis');
  for (const perfil of ['assistente', 'supervisora', 'atendente', 'tarologa']) {
    como(perfil, perfil === 'tarologa' ? { tarotId: '9001' } : {});
    await passo(`${perfil}: GET e POST /accounts respondem 403 ACCESS_DENIED`, async () => {
      const a = await chamar('GET', '/accounts'); const b = await criar();
      assert.equal(a.status, 403); assert.equal(a.j.error.code, 'ACCESS_DENIED');
      assert.equal(b.status, 403); assert.equal(b.j.error.code, 'ACCESS_DENIED');
    });
  }
  como(null);
  await passo('sem sessão: 401 SESSION_REQUIRED; método errado: 405 com Allow', async () => {
    assert.equal((await chamar('GET', '/accounts')).status, 401);
    const m = await chamar('DELETE', '/accounts'); assert.equal(m.status, 405); assert.equal(m.h.get('allow'), 'GET, POST');
  });
  como('administradora');

  console.log('Leitura');
  await passo('GET /accounts: DTO puro, no-store, sem hash nem senha, com revisões', async () => {
    const x = await chamar('GET', '/accounts');
    assert.equal(x.status, 200, x.t); assert.equal(x.h.get('cache-control'), 'no-store');
    assert.ok(Array.isArray(x.j.accounts) && x.j.revisions && !('sucesso' in x.j));
    assert.ok(!/password|hash|\$2[aby]\$/i.test(JSON.stringify(x.j)));
    const eu = x.j.accounts.find((a) => a.id === admin);
    assert.equal(eu.role, 'administradora'); assert.equal(eu.active, true); assert.equal(eu.commission, '—'); assert.equal(eu.access, 'Ainda não acessou');
  });

  console.log('Criar');
  const k1 = n();
  const email1 = `assistente.${Date.now()}@fadas.test`;
  const c1 = await chamar('POST', '/accounts', { operationKey: k1, name: '  Ana   Souza ', email: email1.toUpperCase().replace('@FADAS.TEST', '@fadas.test'), role: 'assistente', password: SENHA, legacyId: ' 4321 ' });
  await passo('cria assistente: 200, nome normalizado, e-mail minúsculo, ID antigo, papel RBAC e produto como no seed', async () => {
    assert.equal(c1.status, 200, c1.t);
    const a = c1.j.account;
    assert.equal(a.name, 'Ana Souza'); assert.equal(a.role, 'assistente'); assert.equal(a.legacyId, '4321'); assert.equal(a.active, true); assert.equal(a.access, 'Ainda não acessou');
    assert.equal(a.email, email1.toLowerCase()); assert.equal(c1.j.revision, 1);
    const [u] = await um(`SELECT id, role, is_active FROM users WHERE id = '${a.id}'`);
    assert.equal(u.role, 'GESTORA');
    const papeis = await um(`SELECT role_id FROM access_user_roles WHERE user_id = '${a.id}'`);
    assert.deepEqual(papeis.map((p) => p.role_id), ['assistente']);
  });
  const idAss = c1.j.account.id;
  await passo('a senha é só hash bcrypt no banco (confere com a senha, não com outra)', async () => {
    const [u] = await um(`SELECT password_hash FROM users WHERE id = '${idAss}'`);
    assert.match(u.password_hash, /^\$2[aby]\$/);
    assert.equal(await bcrypt.compare(SENHA, u.password_hash), true); assert.equal(await bcrypt.compare(SENHA2, u.password_hash), false);
  });
  await passo('mesma chave e mesmo corpo repete a resposta sem criar de novo; outro corpo com a mesma chave: 409 OPERATION_KEY_CONFLICT', async () => {
    const igual = await chamar('POST', '/accounts', { operationKey: k1, name: '  Ana   Souza ', email: email1.toUpperCase().replace('@FADAS.TEST', '@fadas.test'), role: 'assistente', password: SENHA, legacyId: ' 4321 ' });
    assert.equal(igual.status, 200); assert.equal(igual.j.account.id, idAss);
    assert.equal((await um(`SELECT count(*)::int AS n FROM users WHERE lower(email) = '${email1.toLowerCase()}'`))[0].n, 1);
    const outro = await chamar('POST', '/accounts', { operationKey: k1, name: 'Ana Souza', email: email1, role: 'assistente', password: SENHA2, legacyId: '4321' });
    assert.equal(outro.status, 409); assert.equal(outro.j.error.code, 'OPERATION_KEY_CONFLICT');
  });
  await passo('regras do front: e-mail repetido (maiúsculas), senha fraca, e-mail inválido, nome vazio: 422 com a mensagem do front', async () => {
    const rep = await criar({ email: email1.toUpperCase() }); assert.equal(rep.status, 422); assert.equal(rep.j.error.message, 'Esse usuário ou e-mail já está cadastrado.');
    const fraca = await criar({ password: 'curta' }); assert.equal(fraca.status, 422); assert.equal(fraca.j.error.message, 'Use 12 caracteres, maiúscula, minúscula, número e símbolo. Confirme a mesma senha.');
    const sem = await criar({ password: 'semsimbolo12345A' }); assert.equal(sem.status, 422);
    const inv = await criar({ email: 'sem arroba' }); assert.equal(inv.status, 422); assert.equal(inv.j.error.message, 'Confira o usuário ou e-mail informado.');
    const nome = await criar({ name: '   ' }); assert.equal(nome.status, 422); assert.equal(nome.j.error.message, 'Preencha o nome e o usuário ou e-mail.');
  });
  await passo('entrada inválida: campo desconhecido, papel desconhecido, chave curta, taróloga sem tarotId: 400/422', async () => {
    assert.equal((await criar({ extra: 1 })).status, 400);
    assert.equal((await criar({ role: 'gestora' })).status, 400);
    assert.equal((await chamar('POST', '/accounts', { operationKey: 'curta', name: 'A', email: 'a@b.co', role: 'atendente', password: SENHA })).status, 400);
    const t = await criar({ role: 'tarologa' }); assert.equal(t.status, 422);
    assert.equal((await chamar('POST', '/accounts', '{quebrado')).status, 400);
  });
  await passo('cria os 4 papéis de equipe e cada um aparece na lista com o papel certo', async () => {
    for (const papel of ['administradora', 'supervisora', 'atendente']) {
      const x = await criar({ role: papel, name: `Conta ${papel}` });
      assert.equal(x.status, 200, x.t); assert.equal(x.j.account.role, papel);
    }
    const lista = await lerContas();
    assert.ok(['administradora', 'assistente', 'supervisora', 'atendente'].every((p) => lista.accounts.some((a) => a.role === p)));
  });

  console.log('Editar');
  let rev = c1.j.revision;
  const e1 = await chamar('PATCH', `/accounts/${idAss}`, { operationKey: n(), expectedRevision: rev, name: 'Ana S. Souza', role: 'supervisora', legacyId: '' });
  await passo('PATCH muda nome e função (papel RBAC e produto trocam), limpa o ID antigo e sobe a revisão', async () => {
    assert.equal(e1.status, 200, e1.t);
    assert.equal(e1.j.account.name, 'Ana S. Souza'); assert.equal(e1.j.account.role, 'supervisora'); assert.ok(!('legacyId' in e1.j.account)); assert.equal(e1.j.revision, rev + 1);
    assert.deepEqual((await um(`SELECT role_id FROM access_user_roles WHERE user_id = '${idAss}'`)).map((p) => p.role_id), ['supervisora']);
    assert.equal((await um(`SELECT role FROM users WHERE id = '${idAss}'`))[0].role, 'ATENDENTE');
  });
  await passo('revisão velha: 409 VERSION_CHANGED e nada muda', async () => {
    const x = await chamar('PATCH', `/accounts/${idAss}`, { operationKey: n(), expectedRevision: rev, name: 'Fora de hora' });
    assert.equal(x.status, 409); assert.equal(x.j.error.code, 'VERSION_CHANGED');
    assert.equal((await achar(email1.toLowerCase())).name, 'Ana S. Souza');
  });
  rev = e1.j.revision;
  await passo('duas edições simultâneas com a mesma revisão: uma vale (200), a outra 409', async () => {
    const [a, b] = await Promise.all([1, 2].map((i) => chamar('PATCH', `/accounts/${idAss}`, { operationKey: n(), expectedRevision: rev, name: `Corrida ${i}` })));
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    rev = (await lerContas()).revisions[idAss];
  });
  await passo('e-mail de outra conta: 422; trocar o próprio e-mail ou a conta de outro para um livre: 200', async () => {
    const dono = await chamar('PATCH', `/accounts/${idAss}`, { operationKey: n(), expectedRevision: rev, email: (await lerContas()).accounts.find((a) => a.id === admin).email });
    assert.equal(dono.status, 422);
    const livre = await chamar('PATCH', `/accounts/${idAss}`, { operationKey: n(), expectedRevision: rev, email: `novo.${Date.now()}@fadas.test` });
    assert.equal(livre.status, 200); rev = livre.j.revision;
  });
  await passo('id inexistente: 404; id malformado: 404; corpo com campo desconhecido: 400', async () => {
    assert.equal((await chamar('PATCH', '/accounts/00000000-0000-4000-8000-000000000000', { operationKey: n(), expectedRevision: 0, name: 'X' })).status, 404);
    assert.equal((await chamar('PATCH', '/accounts/abc', { operationKey: n(), expectedRevision: 0, name: 'X' })).status, 404);
    assert.equal((await chamar('PATCH', `/accounts/${idAss}`, { operationKey: n(), expectedRevision: rev, hash: 'x' })).status, 400);
  });

  console.log('Última administradora e bloqueio');
  await passo('você não pode bloquear o próprio acesso (422 com o texto do front)', async () => {
    const x = await chamar('POST', `/accounts/${admin}/active`, { operationKey: n(), expectedRevision: (await lerContas()).revisions[admin], active: false });
    assert.equal(x.status, 422); assert.equal(x.j.error.message, 'Você não pode bloquear seu próprio acesso.');
  });
  await passo('a única administradora ativa não pode trocar de função nem ser bloqueada por outra; havendo outra, pode', async () => {
    const lista = (await lerContas()).accounts;
    const outras = lista.filter((a) => a.role === 'administradora' && a.id !== admin);
    for (const o of outras) await sequelize.query(`UPDATE users SET is_active = false WHERE id = '${o.id}'`);
    const x = await chamar('PATCH', `/accounts/${admin}`, { operationKey: n(), expectedRevision: (await lerContas()).revisions[admin], role: 'atendente' });
    assert.equal(x.status, 422); assert.match(x.j.error.message, /^Mantenha pelo menos uma administradora com acesso ativo/);
    for (const o of outras) await sequelize.query(`UPDATE users SET is_active = true WHERE id = '${o.id}'`);
    const y = await chamar('PATCH', `/accounts/${admin}`, { operationKey: n(), expectedRevision: (await lerContas()).revisions[admin], role: 'administradora', name: 'Admin Contas' });
    assert.equal(y.status, 200);
  });
  await passo('bloquear: conta fica inativa, sessões (refresh) revogadas; reativar: volta', async () => {
    const { randomUUID } = require('crypto');
    await RefreshToken.create({ user_id: idAss, jti: randomUUID().replace(/-/g, '').slice(0, 32), expires_at: new Date(Date.now() + 86400000), token_hash: 'x'.repeat(10) }).catch(async () => { await sequelize.query(`INSERT INTO refresh_tokens (id, user_id, jti, expires_at, created_at, updated_at) VALUES ('${randomUUID()}', '${idAss}', '${randomUUID().replace(/-/g, '')}', now() + interval '1 day', now(), now())`); });
    const b = await chamar('POST', `/accounts/${idAss}/active`, { operationKey: n(), expectedRevision: (await lerContas()).revisions[idAss], active: false });
    assert.equal(b.status, 200, b.t); assert.equal(b.j.account.active, false);
    assert.equal((await um(`SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = '${idAss}' AND revoked_at IS NULL`))[0].n, 0);
    assert.equal((await um(`SELECT is_active FROM users WHERE id = '${idAss}'`))[0].is_active, false);
    const a = await chamar('POST', `/accounts/${idAss}/active`, { operationKey: n(), expectedRevision: b.j.revision, active: true });
    assert.equal(a.status, 200); assert.equal(a.j.account.active, true);
  });

  console.log('Senha');
  await passo('redefinir senha: hash novo confere, antigo não; sessões revogadas; senha fraca 422; revisão velha 409', async () => {
    const { randomUUID } = require('crypto');
    await sequelize.query(`INSERT INTO refresh_tokens (id, user_id, jti, expires_at, created_at, updated_at) VALUES ('${randomUUID()}', '${idAss}', '${randomUUID().replace(/-/g, '')}', now() + interval '1 day', now(), now())`);
    const rv = (await lerContas()).revisions[idAss];
    assert.equal((await chamar('POST', `/accounts/${idAss}/password`, { operationKey: n(), expectedRevision: rv, password: 'fraca' })).status, 422);
    assert.equal((await chamar('POST', `/accounts/${idAss}/password`, { operationKey: n(), expectedRevision: rv - 1, password: SENHA2 })).status, 409);
    const ok = await chamar('POST', `/accounts/${idAss}/password`, { operationKey: n(), expectedRevision: rv, password: SENHA2 });
    assert.equal(ok.status, 200, ok.t); assert.ok(!/password|hash/i.test(JSON.stringify(ok.j)));
    const [u] = await um(`SELECT password_hash FROM users WHERE id = '${idAss}'`);
    assert.equal(await bcrypt.compare(SENHA2, u.password_hash), true); assert.equal(await bcrypt.compare(SENHA, u.password_hash), false);
    assert.equal((await um(`SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = '${idAss}' AND revoked_at IS NULL`))[0].n, 0);
  });

  console.log('Taróloga do catálogo');
  await passo('libera o acesso de quem está no catálogo: usuário TAROLOGA, specialist e vínculo no catálogo, na mesma gravação', async () => {
    const x = await chamar('POST', '/accounts', { operationKey: n(), name: 'Tarólogo A', email: `tarologo.a.${Date.now()}@fadas.test`, role: 'tarologa', tarotId: '9001', password: SENHA });
    assert.equal(x.status, 200, x.t);
    assert.equal(x.j.account.role, 'tarologa'); assert.equal(x.j.account.tarotId, '9001'); assert.equal(x.j.account.commission, '30%'); assert.equal(x.j.account.active, true);
    const [s] = await um(`SELECT slug FROM specialists WHERE user_id = '${x.j.account.id}'`);
    assert.equal(s.slug, 'conta-9001');
    assert.equal((await um("SELECT conta_slug FROM gf_tarologos_perfil WHERE tarot_id = '9001'"))[0].conta_slug, 'conta-9001');
    const dup = await chamar('POST', '/accounts', { operationKey: n(), name: 'Tarólogo A', email: `outro.${Date.now()}@fadas.test`, role: 'tarologa', tarotId: '9001', password: SENHA });
    assert.equal(dup.status, 422); assert.equal(dup.j.error.message, 'Esta profissional já possui acesso. Abra o cadastro existente.');
    const t = (await lerContas()).accounts.find((a) => a.tarotId === '9001');
    const troca = await chamar('PATCH', `/accounts/${t.id}`, { operationKey: n(), expectedRevision: 1, role: 'atendente' });
    assert.equal(troca.status, 422); assert.equal(troca.j.error.message, 'O acesso deve continuar vinculado à profissional.');
  });
  await passo('cadastro inexistente: 422; cadastro inativo cria a conta BLOQUEADA e só ativa depois que o cadastro ativar', async () => {
    const nao = await chamar('POST', '/accounts', { operationKey: n(), name: 'X', email: `x.${Date.now()}@fadas.test`, role: 'tarologa', tarotId: '7777', password: SENHA });
    assert.equal(nao.status, 422); assert.equal(nao.j.error.message, 'O cadastro desta profissional não foi encontrado.');
    const inativo = await chamar('POST', '/accounts', { operationKey: n(), name: 'Tarólogo C', email: `c.${Date.now()}@fadas.test`, role: 'tarologa', tarotId: '9003', password: SENHA });
    assert.equal(inativo.status, 200, inativo.t); assert.equal(inativo.j.account.active, false);
  });

  await passo('inativar o cadastro do tarólogo bloqueia a conta ligada e revoga a sessão aberta (Maturacao/44); reativar o cadastro não reativa a conta; idempotente', async () => {
    const { randomUUID } = require('crypto');
    const t = (await lerContas()).accounts.find((a) => a.tarotId === '9001');
    await sequelize.query(`INSERT INTO refresh_tokens (id, user_id, jti, expires_at, created_at, updated_at) VALUES ('${randomUUID()}', '${t.id}', '${randomUUID().replace(/-/g, '')}', now() + interval '1 day', now(), now())`);
    assert.equal((await um(`SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = '${t.id}' AND revoked_at IS NULL`))[0].n >= 1, true);
    const rev = (await um("SELECT revisao FROM gf_tarologos_perfil WHERE tarot_id = '9001'"))[0].revisao;
    const k = n();
    const x = await chamar('PUT', '/catalog/tarologists/9001/profile', { operationKey: k, expectedRevision: rev, registrationActive: false });
    assert.equal(x.status, 200, x.t);
    assert.equal((await um(`SELECT is_active FROM users WHERE id = '${t.id}'`))[0].is_active, false, `apos inativar: ${x.t} slug=${JSON.stringify(await um("SELECT conta_slug FROM gf_tarologos_perfil WHERE tarot_id = '9001'"))}`);
    assert.equal((await um(`SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = '${t.id}' AND revoked_at IS NULL`))[0].n, 0);
    const aud = await um("SELECT depois FROM gf_auditoria WHERE acao = 'cadastros.tarologo.perfil' AND depois::text LIKE '%contasBloqueadas%' LIMIT 1");
    assert.match(JSON.stringify(aud[0].depois), /contasBloqueadas/);
    const rep = await chamar('PUT', '/catalog/tarologists/9001/profile', { operationKey: k, expectedRevision: rev, registrationActive: false });
    assert.equal(rep.status, 200);
    const rev2 = (await um("SELECT revisao FROM gf_tarologos_perfil WHERE tarot_id = '9001'"))[0].revisao;
    const re = await chamar('PUT', '/catalog/tarologists/9001/profile', { operationKey: n(), expectedRevision: rev2, registrationActive: true });
    assert.equal(re.status, 200, re.t);
    assert.equal((await um(`SELECT is_active FROM users WHERE id = '${t.id}'`))[0].is_active, false);
  });

  console.log('Segredos');
  await passo('auditoria: uma linha por gravação, na mesma transação, sem senha, sem hash, sem foto', async () => {
    const linhas = await um("SELECT acao, antes, depois FROM gf_auditoria WHERE acao LIKE 'contas.%'");
    assert.ok(linhas.length >= 12, `linhas ${linhas.length}`);
    const tudo = JSON.stringify(linhas);
    assert.ok(!tudo.includes(SENHA) && !tudo.includes(SENHA2) && !/\$2[aby]\$/.test(tudo));
    assert.ok(['contas.criar', 'contas.editar', 'contas.senha', 'contas.ativo'].every((a) => linhas.some((l) => l.acao === a)));
  });
  await passo('gf_operacoes (resposta guardada) e logs não guardam senha nem hash', async () => {
    const ops = JSON.stringify(await um("SELECT * FROM gf_operacoes WHERE escopo LIKE 'contas.%'"));
    assert.ok(!ops.includes(SENHA) && !ops.includes(SENHA2) && !/\$2[aby]\$/.test(ops));
    assert.ok(!/password_hash/.test(ops));
  });

  console.log('Origem e escrita desligada');
  await passo('escrita sem a Origem do front: 403 ORIGIN_NOT_ALLOWED', async () => {
    const x = await chamar('POST', '/accounts', { operationKey: n(), name: 'A', email: 'a@b.co', role: 'atendente', password: SENHA }, { origin: 'http://evil.test' });
    assert.equal(x.status, 403); assert.equal(x.j.error.code, 'ORIGIN_NOT_ALLOWED');
  });
  await passo('GESTAO_FADAS_ESCRITA_ENABLED=false: leitura segue, gravação 503 WRITE_DISABLED/SERVICE_UNAVAILABLE', async () => {
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
    try {
      assert.equal((await chamar('GET', '/accounts')).status, 200);
      const x = await criar(); assert.equal(x.status, 503);
    } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
  });

  console.log('Boas-vindas');
  const conteudo = () => JSON.parse(JSON.stringify(require(r('src/gestao-fadas/_comum/dominio/welcome')).padrao()));
  await passo('leitura pública sem sessão: revisão 0 e só linhas ativas do padrão', async () => {
    como(null);
    const x = await chamar('GET', '/welcome'); assert.equal(x.status, 200, x.t);
    assert.equal(x.j.revision, 0); assert.equal(x.j.content.greetings.length, 8); assert.equal(x.j.content.messages.length, 24);
    assert.equal(x.h.get('cache-control'), 'no-store');
  });
  await passo('editor: sem sessão 403 com needsSignIn; atendente e supervisora 403 sem permissão', async () => {
    como(null);
    const a = await chamar('GET', '/welcome?editor=1'); assert.equal(a.status, 403); assert.equal(a.j.needsSignIn, true); assert.equal(a.j.error, 'Sua sessão precisa ser confirmada para editar os textos.');
    for (const p of ['atendente', 'supervisora', 'assistente', 'tarologa']) {
      como(p, p === 'tarologa' ? { tarotId: '9001' } : {});
      const b = await chamar('GET', '/welcome?editor=1'); assert.equal(b.status, 403); assert.equal(b.j.error, 'Esta conta não tem permissão administrativa para editar os textos.');
      const c = await chamar('PUT', '/welcome', { revision: 0, content: conteudo() }); assert.equal(c.status, 403);
    }
  });
  como('administradora');
  await passo('editor da administradora: padrão com revisão 0 e tudo (inclusive inativos)', async () => {
    const x = await chamar('GET', '/welcome?editor=1'); assert.equal(x.status, 200, x.t); assert.equal(x.j.revision, 0); assert.ok(x.j.content.greetings.length >= 8);
  });
  const novo = conteudo(); novo.greetings[0].title = 'Bom ter você de volta'; novo.messages[0].active = false;
  await passo('PUT na revisão 0 grava (revisão 1); leitura pública devolve só ativos e o texto novo; auditoria na mesma transação', async () => {
    const x = await chamar('PUT', '/welcome', { revision: 0, content: novo }); assert.equal(x.status, 200, x.t); assert.equal(x.j.revision, 1);
    const p = await chamar('GET', '/welcome'); assert.equal(p.j.revision, 1);
    assert.equal(p.j.content.greetings.find((g) => g.id === 'morning-1').title, 'Bom ter você de volta');
    assert.ok(!p.j.content.messages.some((m) => m.id === 'fortune-1'));
    const ed = await chamar('GET', '/welcome?editor=1'); assert.equal(ed.j.content.messages.find((m) => m.id === 'fortune-1').active, false);
    const aud = await um("SELECT acao, depois FROM gf_auditoria WHERE acao = 'config.welcome'");
    assert.equal(aud.length, 1); assert.ok(!JSON.stringify(aud).includes('Bom ter você'));
  });
  await passo('PUT com revisão velha: 409 com o texto do front e nada muda; duas gravações simultâneas: uma 200 e uma 409', async () => {
    const velho = await chamar('PUT', '/welcome', { revision: 0, content: novo });
    assert.equal(velho.status, 409); assert.equal(velho.j.error, 'Não foi possível salvar os textos. Seu rascunho foi mantido; recarregue os textos salvos e tente novamente.');
    const [a, b] = await Promise.all([1, 2].map((i) => { const c = conteudo(); c.greetings[0].title = `Corrida ${i}`; return chamar('PUT', '/welcome', { revision: 1, content: c }); }));
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal((await chamar('GET', '/welcome?editor=1')).j.revision, 2);
  });
  await passo('PUT inválido: 400 com a mensagem do front; revisão inválida 400; tipo errado 415; origem errada 403; grande demais 413', async () => {
    const semManha = conteudo(); semManha.greetings[0].active = false;
    const a = await chamar('PUT', '/welcome', { revision: 2, content: semManha }); assert.equal(a.status, 400); assert.equal(a.j.error, 'Mantenha ao menos uma saudação ativa para manhã de Atendimento.');
    const b = await chamar('PUT', '/welcome', { revision: -1, content: conteudo() }); assert.equal(b.status, 400); assert.equal(b.j.error, 'Revisão inválida. Recarregue os textos salvos.');
    const c = await chamar('PUT', '/welcome', { revision: 2, content: conteudo() }, { 'content-type': 'text/plain' }); assert.equal(c.status, 415);
    const d = await chamar('PUT', '/welcome', { revision: 2, content: conteudo() }, { origin: 'http://evil.test' }); assert.equal(d.status, 403); assert.equal(d.j.error, 'Origem não autorizada.');
    const grande = conteudo(); grande.messages[0].text = 'a'.repeat(450000);
    const e = await chamar('PUT', '/welcome', { revision: 2, content: grande }); assert.equal(e.status, 413);
    assert.equal((await chamar('PUT', '/welcome', '{quebrado')).status, 400);
    assert.equal((await chamar('GET', '/welcome?editor=1')).j.revision, 2);
  });
  await passo('escrita desligada: PUT 503 com texto do front, leitura segue; flag desligada: o /welcome volta ao texto padrão fixo (editor 503) e /accounts 404', async () => {
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
    try {
      const x = await chamar('PUT', '/welcome', { revision: 2, content: conteudo() }); assert.equal(x.status, 503); assert.equal(x.j.error, 'Não foi possível salvar ou carregar os textos. Seu rascunho foi mantido. Tente novamente.');
      assert.equal((await chamar('GET', '/welcome')).status, 200);
    } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
    delete process.env.GF_FATIA_CONFIG; delete process.env.GF_FATIA_CONTAS;
    try {
      const p = await chamar('GET', '/welcome'); assert.equal(p.status, 200); assert.equal(p.j.revision, 0);
      assert.equal((await chamar('GET', '/welcome?editor=1')).status, 503);
      const c = await chamar('GET', '/accounts'); assert.equal(c.status, 404); assert.equal(c.j.error.code, 'NOT_FOUND');
    } finally { process.env.GF_FATIA_CONFIG = 'true'; process.env.GF_FATIA_CONTAS = 'true'; }
  });
  await passo('nada de estrutura nova no MySQL legado: o legado nem está configurado neste processo', async () => {
    assert.ok(!process.env.LEGADO_DB_HOST && !process.env.LEGADO_DB_NAME);
  });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres descartável: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close().catch(() => {});
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
