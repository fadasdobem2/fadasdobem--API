'use strict';

/**
 * FILHO de scripts/verificar-gf-email.js: roda contra o Postgres DESCARTÁVEL (fdb_email_*) já migrado. Prova pelo HTTP do gate, com banco real e um servidor
 * SMTP FALSO local (nada sai da máquina; usuários, senha e caixas são de mentira): configuração (cifrada no banco), teste de envio, histórico que só acrescenta,
 * convite por e-mail de uma conta real (token só na mensagem, hash no banco, 48h, só o último vale, espera de 30 s), aceite pelo link, recuperação pública
 * sem revelar a conta, bloqueio por conta inativa e CHECKs/gatilho da migração.
 */

const path = require('path');
const assert = require('assert');
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const { randomUUID, createHash } = require('crypto');
const express = require('express');
const { raiz, passo, resumo } = require('../apoio-gf-banco-novo/comum');
const { criarServidor } = require('./smtp-falso');
const C = require('./cenarios');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_EMAIL: 'true', GF_FATIA_CONTAS: 'true',
  GF_EMAIL_CHAVE_SEGREDO: C.MESTRA, GF_EMAIL_ENVIO_ENABLED: 'true', FADAS_ORIGIN: C.ORIGEM, GF_EMAIL_ORIGEM_PUBLICA: C.ORIGEM, JWT_SECRET: 'segredo-de-teste-do-filho',
});
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { User, StaffProfile } = require(r('src/models'));
  const smtp = await criarServidor({ modo: 'starttls' });
  // Só o envio: o DNS devolve um endereço público e o socket vai para o servidor falso local.
  const origNet = net.connect; const origTls = tls.connect; const origLookup = dns.promises.lookup;
  dns.promises.lookup = async (h, o) => (h === 'smtp.example.org' ? [{ address: '8.8.8.8', family: 4 }] : origLookup(h, o));
  net.connect = (o) => (o && o.host === '8.8.8.8' ? origNet({ host: '127.0.0.1', port: smtp.porta }) : origNet(o));
  tls.connect = (o, ...a) => origTls(o && o.servername === 'smtp.example.org' ? { ...o, ...(o.socket ? {} : { host: '127.0.0.1', port: smtp.porta }), ca: smtp.ca } : o, ...a);

  const criar = async (nome, role, ativo = true) => { const id = randomUUID(); await User.create({ id, email: `${nome.toLowerCase().replace(/\W+/g, '.')}.${id.slice(0, 6)}@teste.local`, role, is_active: ativo }); await StaffProfile.create({ user_id: id, display_name: nome }); return id; };
  const uAdm = await criar('Gestora Email', 'GESTORA'); const uAt = await criar('Atendente Convite', 'ATENDENTE'); const uOff = await criar('Atendente Bloqueada', 'ATENDENTE', false);
  await sequelize.query('INSERT INTO gf_contas_ext (user_id, revisao, acesso_pendente) VALUES (:u, 1, true)', { replacements: { u: uAt } }); // conta nova, ainda sem acesso
  const emailDe = async (id) => (await sequelize.query('SELECT email FROM users WHERE id = :id', { replacements: { id } }))[0][0].email;
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  let sessao = { userId: uAdm, role: 'administradora', displayName: 'Gestora Email' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => (sessao ? { status: 'identity', identity: sessao, sessionId: 'sessao-email' } : { status: 'absent' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1'); await new Promise((f) => srv.once('listening', f));
  const host = `127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, recurso, corpo) => {
    const resp = await fetch(`http://${host}/api/email?resource=${recurso}`, { method: metodo, headers: { ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(metodo !== 'GET' ? { origin: C.ORIGEM } : {}) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ } return { status: resp.status, j, t };
  };
  const um = async (sql, rep) => (await sequelize.query(sql, { replacements: rep }))[0];
  const ultimaMensagem = () => smtp.recebidos[smtp.recebidos.length - 1];
  const tokenDa = (m) => (m.dados.replace(/=\r?\n/g, '') ? Buffer.from(m.dados.split('\n\n').slice(1).join('').replace(/\s+/g, ''), 'base64').toString('utf8') : '').match(/#convite=([a-f0-9]{64})/)[1];
  const configuracao = (rev, conexoes) => ({ settings: { ...C.base(), revision: rev, connections: conexoes || [C.smtp({ label: 'SMTP de mentira' })] }, secrets: { one: 'senha-ficticia' } });

  console.log('Esquema');
  await passo('tabelas existem, a migração roda de novo sem erro e o model confere', async () => {
    const tabelas = await um("SELECT string_agg(table_name, ',' ORDER BY table_name) AS t FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('gf_email_config','gf_email_eventos','gf_formas_atendimento_dia')");
    assert.equal(tabelas[0].t, 'gf_email_config,gf_email_eventos,gf_formas_atendimento_dia', JSON.stringify(tabelas));
    await require(r('migrations/20261214000000-gestao-fadas-email')).up({ sequelize }); await require(r('migrations/20261215000000-gestao-fadas-formas-atendimento')).up({ sequelize });
  });

  console.log('Configuração pelo gate (banco real)');
  await passo('sem configuração: GET devolve a vazia e configured=false; availability enabled=true e invitations=true', async () => {
    const a = await chamar('GET', 'availability'); assert.deepEqual(a.j, { enabled: true, invitations: true });
    const g = await chamar('GET', 'settings'); assert.equal(g.status, 200); assert.equal(g.j.configured, false); assert.equal(g.j.settings.revision, 0);
    assert.equal((await chamar('POST', 'test', { purpose: 'usuarios', to: 'a@example.org' })).status, 409);
  });
  await passo('PUT guarda a configuração SEM segredo em claro: o banco só tem o texto cifrado; a resposta e o GET só dizem hasSecret', async () => {
    const p = await chamar('PUT', 'settings', configuracao(0)); assert.equal(p.status, 200, p.t); assert.equal(p.j.settings.revision, 1); assert.equal(p.j.settings.connections[0].hasSecret, true);
    const linha = (await um('SELECT conteudo::text AS c, segredos::text AS s, revisao FROM gf_email_config'))[0];
    assert.ok(!linha.c.includes('senha-ficticia') && !linha.s.includes('senha-ficticia') && /v1\./.test(linha.s) && Number(linha.revisao) === 1);
    const g = await chamar('GET', 'settings'); assert.ok(!g.t.includes('senha-ficticia') && !g.t.includes('v1.')); assert.equal(g.j.settings.revision, 1);
  });
  await passo('revisão velha é 409; PUT sem segredo reaproveita o cifrado; trocar o servidor sem segredo novo é 400', async () => {
    assert.equal((await chamar('PUT', 'settings', configuracao(0))).status, 409);
    const sem = { settings: { ...C.base(), revision: 1, connections: [C.smtp({ label: 'Outro nome' })] } }; assert.equal((await chamar('PUT', 'settings', sem)).status, 200);
    const troca = { settings: { ...C.base(), revision: 2, connections: [C.smtp({ host: 'outro.example.org' })] } }; const t = await chamar('PUT', 'settings', troca); assert.equal(t.status, 400); assert.match(t.j.error, /Informe a senha/);
    assert.equal(Number((await um('SELECT revisao FROM gf_email_config'))[0].revisao), 2);
  });
  await passo('corrida: dois PUT com a mesma revisão, só um grava', async () => {
    const dois = await Promise.all([1, 2].map((i) => chamar('PUT', 'settings', { settings: { ...C.base(), revision: 2, connections: [C.smtp({ label: `Corrida ${i}` })] } })));
    assert.deepEqual(dois.map((x) => x.status).sort(), [200, 409]); assert.equal(Number((await um('SELECT revisao FROM gf_email_config'))[0].revisao), 3);
  });

  console.log('Envio real (SMTP falso local, STARTTLS)');
  await passo('teste de envio entrega UMA mensagem ao destinatário pedido, pelo remetente da finalidade, e deixa recibo "accepted"', async () => {
    const x = await chamar('POST', 'test', { purpose: 'financeiro', to: 'laya@example.org' }); assert.equal(x.status, 200, x.t); assert.equal(x.j.status, 'accepted');
    const m = ultimaMensagem(); assert.deepEqual(m.auth, { usuario: 'envio', senha: 'senha-ficticia' }); assert.match(m.rcpt, /TO:<laya@example\.org>/i); assert.match(m.mailFrom, /FROM:<financeiro@example\.org>/i); assert.equal(m.seguro, true);
    const h = await chamar('GET', 'history'); assert.equal(h.j.events[0].status, 'accepted'); assert.equal(h.j.events[0].purpose, 'financeiro'); assert.ok(!h.t.includes('laya@example.org'), 'o histórico não guarda destinatário');
  });
  await passo('servidor recusa a senha: 502 "failed", sem texto do servidor, e o histórico guarda só o texto da API', async () => {
    const velha = process.env.GF_EMAIL_CHAVE_SEGREDO; // o segredo guardado é 'senha-ficticia'; o servidor passa a exigir outra
    const falso = await criarServidor({ modo: 'starttls', senhaCerta: 'outra-senha' }); const porta = smtp.porta; smtp.porta = falso.porta;
    try { const x = await chamar('POST', 'test', { purpose: 'financeiro', to: 'laya@example.org' }); assert.equal(x.status, 502); assert.equal(x.j.status, 'failed'); assert.ok(!/535|recusado|senha/i.test(JSON.stringify(x.j.error))); } finally { smtp.porta = porta; await falso.fechar(); process.env.GF_EMAIL_CHAVE_SEGREDO = velha; }
    assert.equal((await chamar('GET', 'history')).j.events[0].status, 'failed');
  });

  console.log('Convite por e-mail (conta real do banco)');
  let token1;
  await passo('administradora envia o convite: a mensagem sai pela finalidade "usuarios" com o link de 48h, o banco guarda só o hash e o token não volta na resposta', async () => {
    const antes = smtp.recebidos.length; const x = await chamar('POST', 'invitation', { accountId: uAt }); assert.equal(x.status, 200, x.t);
    assert.equal(x.j.status, 'accepted'); assert.equal(x.j.kind, 'first-access'); assert.equal(x.j.accountId, uAt); assert.ok(Math.abs(Date.parse(x.j.expiresAt) - Date.now() - 48 * 3600000) < 60000);
    assert.equal(smtp.recebidos.length, antes + 1); const m = ultimaMensagem(); assert.match(m.rcpt, new RegExp(`TO:<${(await emailDe(uAt)).replace(/\./g, '\\.')}>`, 'i')); assert.match(m.mailFrom, /acessos@example\.org/);
    token1 = tokenDa(m); assert.ok(!x.t.includes(token1));
    const l = (await um('SELECT convite_hash, convite_tipo, acesso_pendente FROM gf_contas_ext WHERE user_id = :u', { u: uAt }))[0];
    assert.equal(l.convite_hash, createHash('sha256').update(token1).digest('hex')); assert.equal(l.convite_tipo, 'first-access'); assert.equal(l.acesso_pendente, true);
    assert.equal((await um("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'contas.convite.email' AND entidade_id = :u", { u: String(uAt) }))[0].n, '1');
    assert.equal((await chamar('GET', 'history')).j.events[0].accountId, uAt);
  });
  await passo('reenvio imediato é 429 (espera de 30 s) e não troca o convite; conta bloqueada e conta inexistente recebem recusa sem pista', async () => {
    const x = await chamar('POST', 'invitation', { accountId: uAt }); assert.equal(x.status, 429); assert.match(x.j.error, /30 segundos/);
    assert.equal((await um('SELECT convite_hash FROM gf_contas_ext WHERE user_id = :u', { u: uAt }))[0].convite_hash, createHash('sha256').update(token1).digest('hex'));
    for (const id of [uOff, randomUUID()]) { const y = await chamar('POST', 'invitation', { accountId: id }); assert.equal(y.status, 409); assert.match(y.j.error, /Convite indisponível/); }
  });
  await passo('o link vale: inspect mostra nome, e-mail, tipo e validade; senha fraca é 400 e não consome; senha forte aceita e o link some', async () => {
    sessao = null;
    const i = await chamar('POST', 'inspect', { token: token1 }); assert.equal(i.j.status, 'valid'); assert.equal(i.j.kind, 'first-access'); assert.equal(i.j.email, await emailDe(uAt)); assert.ok(i.j.expiresAt);
    assert.equal((await chamar('POST', 'inspect', { token: 'b'.repeat(64) })).j.status, 'invalid'); assert.equal((await chamar('POST', 'inspect', { token: 'x' })).j.status, 'invalid');
    const fraca = await chamar('POST', 'accept', { token: token1, password: 'curta' }); assert.equal(fraca.status, 400); assert.match(fraca.j.error, /15 a 128/);
    assert.equal((await chamar('POST', 'inspect', { token: token1 })).j.status, 'valid');
    assert.equal((await chamar('POST', 'accept', { token: token1, password: `${'a'.repeat(129)}A1!` })).status, 400);
    const ok = await chamar('POST', 'accept', { token: token1, password: 'SenhaLongaSegura123!' }); assert.equal(ok.status, 200, ok.t); assert.deepEqual(ok.j, { status: 'accepted' });
    const d = await chamar('POST', 'accept', { token: token1, password: 'SenhaLongaSegura123!' }); assert.equal(d.status, 409); assert.equal((await chamar('POST', 'inspect', { token: token1 })).j.status, 'used');
    const hash = (await um('SELECT password_hash FROM users WHERE id = :u', { u: uAt }))[0].password_hash; assert.ok(/^\$2[aby]\$/.test(hash) && !hash.includes('SenhaLonga'));
    assert.equal((await um('SELECT acesso_pendente FROM gf_contas_ext WHERE user_id = :u', { u: uAt }))[0].acesso_pendente, false);
  });
  await passo('conta que já acessou recebe link de NOVA SENHA; um segundo envio revoga o primeiro link', async () => {
    sessao = { userId: uAdm, role: 'administradora', displayName: 'Gestora Email' };
    await um("UPDATE gf_contas_ext SET convite_emitido = convite_emitido - interval '5 minutes' WHERE user_id = :u", { u: uAt });
    const a = await chamar('POST', 'invitation', { accountId: uAt }); assert.equal(a.status, 200); assert.equal(a.j.kind, 'reset-password'); const t1 = tokenDa(ultimaMensagem());
    await um("UPDATE gf_contas_ext SET convite_emitido = convite_emitido - interval '5 minutes' WHERE user_id = :u", { u: uAt });
    const b = await chamar('POST', 'invitation', { accountId: uAt }); assert.equal(b.status, 200); const t2 = tokenDa(ultimaMensagem()); assert.notEqual(t1, t2);
    sessao = null; assert.equal((await chamar('POST', 'inspect', { token: t1 })).j.status, 'invalid'); assert.equal((await chamar('POST', 'inspect', { token: t2 })).j.status, 'valid');
  });
  await passo('recuperação pública: resposta idêntica para conta existente, inexistente e bloqueada; só a existente recebe e-mail; o histórico marca "self-recovery"', async () => {
    sessao = null; await um("UPDATE gf_contas_ext SET convite_emitido = convite_emitido - interval '5 minutes' WHERE user_id = :u", { u: uAt });
    const antes = smtp.recebidos.length; const corpos = [];
    for (const e of [await emailDe(uAt), 'ninguem@example.org', await emailDe(uOff), 'ruim']) { const x = await chamar('POST', 'recovery', { email: e }); assert.equal(x.status, 200); corpos.push(x.t); }
    assert.equal(new Set(corpos).size, 1); assert.equal(smtp.recebidos.length, antes + 1);
    sessao = { userId: uAdm, role: 'administradora', displayName: 'Gestora Email' };
    const h = await chamar('GET', 'history'); assert.equal(h.j.events[0].actorId, 'self-recovery'); assert.equal(h.j.events[0].kind, 'invitation');
    sessao = null; const rep = await chamar('POST', 'recovery', { email: await emailDe(uAt) }); assert.equal(rep.status, 200); assert.equal(smtp.recebidos.length, antes + 1, 'repetir dentro de 30 s não envia de novo');
  });
  await passo('atendente não configura nem convida (403 em texto); sem sessão pede entrada (401)', async () => {
    sessao = { userId: uAt, role: 'atendente', displayName: 'At' };
    for (const [m, rec, corpo] of [['GET', 'settings'], ['PUT', 'settings', configuracao(3)], ['POST', 'invitation', { accountId: uAt }], ['POST', 'test', { purpose: 'usuarios', to: 'a@example.org' }], ['GET', 'history']]) { const x = await chamar(m, rec, corpo); assert.equal(x.status, 403, rec); assert.equal(typeof x.j.error, 'string'); }
    sessao = null; assert.equal((await chamar('GET', 'settings')).status, 401);
  });
  await passo('envio desligado (flag) responde 503 sem enviar nada e sem emitir convite', async () => {
    sessao = { userId: uAdm, role: 'administradora', displayName: 'Gestora Email' }; process.env.GF_EMAIL_ENVIO_ENABLED = 'false';
    await um("UPDATE gf_contas_ext SET convite_emitido = convite_emitido - interval '5 minutes' WHERE user_id = :u", { u: uAt });
    const antes = smtp.recebidos.length; const hashAntes = (await um('SELECT convite_hash FROM gf_contas_ext WHERE user_id = :u', { u: uAt }))[0].convite_hash;
    for (const [rec, corpo] of [['invitation', { accountId: uAt }], ['test', { purpose: 'usuarios', to: 'a@example.org' }], ['recovery', { email: await emailDe(uAt) }]]) assert.equal((await chamar('POST', rec, corpo)).status, 503, rec);
    assert.equal(smtp.recebidos.length, antes); assert.equal((await um('SELECT convite_hash FROM gf_contas_ext WHERE user_id = :u', { u: uAt }))[0].convite_hash, hashAntes);
    process.env.GF_EMAIL_ENVIO_ENABLED = 'true';
  });

  console.log('Banco: CHECKs e gatilho');
  await passo('CHECKs recusam segredo em claro no conteúdo, revisão diferente do conteúdo e id fora de 1; o diário de recibos não aceita UPDATE nem DELETE', async () => {
    const tenta = async (sql, rep) => { try { await sequelize.query(sql, { replacements: rep }); return 'gravou'; } catch (e) { return e.parent ? e.parent.code : e.name; } };
    const conteudo = JSON.stringify({ revision: 9, connections: [], purposes: {}, secrets: { a: 'x' } });
    assert.equal(await tenta('UPDATE gf_email_config SET conteudo = CAST(:c AS jsonb)', { c: conteudo }), '23514');
    assert.equal(await tenta("UPDATE gf_email_config SET conteudo = jsonb_set(conteudo, '{password}', '\"x\"')"), '23514');
    assert.equal(await tenta("UPDATE gf_email_config SET conteudo = jsonb_set(conteudo, '{revision}', '99')"), '23514');
    assert.equal(await tenta("INSERT INTO gf_email_config (id, revisao, conteudo, segredos, atualizado_por) VALUES (2, 1, '{\"revision\":1,\"connections\":[],\"purposes\":{}}', '{}', 'x')"), '23514');
    assert.equal(await tenta("INSERT INTO gf_email_eventos (id, ocorreu_em, ator_id, finalidade, tipo, resultado) VALUES ('x1', now(), 'a', 'vendas', 'test', 'accepted')"), '23514');
    assert.equal(await tenta("INSERT INTO gf_email_eventos (id, ocorreu_em, ator_id, finalidade, tipo, resultado) VALUES ('x2', now(), 'a', 'usuarios', 'test', 'failed')"), '23514');
    assert.equal(await tenta("INSERT INTO gf_email_eventos (id, ocorreu_em, ator_id, finalidade, tipo, resultado, codigo_erro) VALUES ('x3', now(), 'a', 'usuarios', 'test', 'accepted', 'e')"), '23514');
    assert.equal(await tenta("UPDATE gf_email_eventos SET resultado = 'accepted'"), 'P0001'); assert.equal(await tenta('DELETE FROM gf_email_eventos'), 'P0001');
  });

  smtp.porta = smtp.porta; net.connect = origNet; tls.connect = origTls; dns.promises.lookup = origLookup;
  await smtp.fechar(); srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nE-mails (banco): ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
