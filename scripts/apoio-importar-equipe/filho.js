'use strict';

/** FILHO de scripts/verificar-gf-importar-equipe.js: roda no Postgres DESCARTÁVEL (fdb_ieq_*) já migrado, com dados FICTÍCIOS. */

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

const CLI = path.join(raiz, 'scripts', 'importar-equipe.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ieq-'));
const cli = (args, envExtra = {}) => {
  const env = { ...process.env, NODE_ENV: 'test', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', DADOS_TESTE_ENABLED: 'false', GF_EMAIL_ENVIO_ENABLED: 'false', JWT_SECRET: process.env.JWT_SECRET || 'segredo-de-teste-local', ...envExtra };
  const p = spawnSync(process.execPath, [CLI, ...args], { cwd: raiz, env, encoding: 'utf8' });
  return { status: p.status, saida: `${p.stdout}${p.stderr}` };
};
const PESSOAS = [
  { nome: ' Ada   Admin ', nomeFada: 'Fada Ada', cargo: 'administrador', email: 'ada.admin@exemplo.test', whatsapp: '11 98888-0001' },
  { nome: 'Sara Super', nomeFada: 'Fada Sara', cargo: 'supervisor', email: 'sara.super@exemplo.test', whatsapp: '(11) 98888-0002' },
  { nome: 'Tito Atende', nomeFada: 'Fada Tito', cargo: 'atendente', email: 'Tito.Atende@exemplo.test', whatsapp: '11988880003' },
  { nome: 'Lia Assiste', nomeFada: 'Fada Lia', cargo: 'assistente', email: 'lia.assiste@exemplo.test', whatsapp: '+55 11 98888-0004' },
];

(async () => {
  const { sequelize } = require(path.join(raiz, 'src/config/database'));
  const { seedAccessCatalog } = require(path.join(raiz, 'src/rbac/rbac.seed'));
  await sequelize.authenticate();
  await seedAccessCatalog({});
  await criarUsuario('Admin Existente'); // assina a operação
  const um = async (sql, rep) => (await sequelize.query(sql, { replacements: rep }))[0];
  const contar = async (t) => Number((await um(`SELECT COUNT(*) AS n FROM ${t}`))[0].n);
  const arq = (nome, dados) => { const f = path.join(tmp, nome); fs.writeFileSync(f, JSON.stringify(dados)); return f; };
  const ARQ = arq('ok.json', PESSOAS);
  const users0 = await contar('users');

  console.log('Simular');
  await passo('--simular --com-banco não grava nada (nem usuário, nem auditoria, nem operação) e lista 4 ok', async () => {
    const aud = await contar('gf_auditoria'); const ops = await contar('gf_operacoes');
    const x = cli(['--arquivo', ARQ, '--simular', '--com-banco']);
    assert.equal(x.status, 0, x.saida); assert.match(x.saida, /ok 4, problemas 0/);
    assert.equal(await contar('users'), users0); assert.equal(await contar('gf_auditoria'), aud); assert.equal(await contar('gf_operacoes'), ops);
  });

  console.log('Gravar');
  await passo('--gravar cria 4 contas com os papéis certos, ativas, SEM senha usável, com acesso pendente e convite aberto', async () => {
    const x = cli(['--arquivo', ARQ, '--gravar']);
    assert.equal(x.status, 0, x.saida); assert.match(x.saida, /criadas 4/);
    assert.equal(await contar('users'), users0 + 4);
    const l = await um("SELECT u.email, u.is_active, u.role, array_agg(r.role_id) AS papeis, e.acesso_pendente, e.convite_hash IS NOT NULL AS convite FROM users u JOIN access_user_roles r ON r.user_id = u.id JOIN gf_contas_ext e ON e.user_id = u.id WHERE u.email LIKE '%@exemplo.test' GROUP BY u.id, e.acesso_pendente, e.convite_hash ORDER BY u.email");
    assert.deepEqual(l.map((c) => [c.email, c.papeis[0], c.is_active, c.acesso_pendente, c.convite]), [
      ['ada.admin@exemplo.test', 'admin', true, true, true], ['lia.assiste@exemplo.test', 'assistente', true, true, true],
      ['sara.super@exemplo.test', 'supervisora', true, true, true], ['tito.atende@exemplo.test', 'atendente', true, true, true]]);
  });
  await passo('nome aparado e gravado como perfil de equipe (staff_profiles)', async () => {
    const [n] = await um("SELECT s.display_name FROM staff_profiles s JOIN users u ON u.id = s.user_id WHERE u.email = 'ada.admin@exemplo.test'");
    assert.equal(n.display_name, 'Ada Admin');
  });
  await passo('nenhum e-mail enviado: a importação não grava envio nem fila de e-mail', async () => {
    const tabs = (await um("SELECT tablename AS nome FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'gf\\_email%'")).map((t) => t.nome);
    console.log(`      (tabelas de e-mail encontradas: ${tabs.length})`);
    for (const t of tabs) assert.equal(await contar(t), 0, t);
  });
  await passo('auditoria: 4 linhas contas.criar, sem senha, token nem WhatsApp', async () => {
    assert.equal(Number((await um("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'contas.criar'"))[0].n), 4);
    const t = JSON.stringify(await um('SELECT antes, depois, motivo FROM gf_auditoria')) + JSON.stringify(await um('SELECT escopo, chave, hash_corpo, resposta FROM gf_operacoes'));
    for (const fone of ['98888-0001', '98888-0002', '988880003', '98888-0004', '9888800']) assert.ok(!t.includes(fone), 'telefone na auditoria');
    assert.ok(!/password|senha":"|token/i.test(JSON.stringify(await um('SELECT antes, depois FROM gf_auditoria'))), 'segredo na auditoria');
  });

  console.log('Idempotência e conflitos');
  await passo('repetir --gravar NÃO duplica (4 já importadas, 0 criadas)', async () => {
    const aud = await contar('gf_auditoria');
    const x = cli(['--arquivo', ARQ, '--gravar']);
    assert.equal(x.status, 0, x.saida); assert.match(x.saida, /criadas 0/); assert.match(x.saida, /já importadas 4/);
    assert.equal(await contar('users'), users0 + 4); assert.equal(await contar('gf_auditoria'), aud);
  });
  await passo('e-mail que já existe como conta (de outra origem) é CONFLITO e não é sobrescrito', async () => {
    await sequelize.query("INSERT INTO users (id, email, password_hash, role, is_active, created_at, updated_at) VALUES (gen_random_uuid(), 'ja.existe@exemplo.test', 'x', 'CLIENTE', true, now(), now())");
    const f = arq('conf.json', [{ nome: 'Outra Pessoa', nomeFada: 'Fada', cargo: 'atendente', email: 'JA.EXISTE@exemplo.test', whatsapp: '11 98888-0009' }]);
    const n = await contar('users');
    const s = cli(['--arquivo', f, '--simular', '--com-banco']); assert.equal(s.status, 1); assert.match(s.saida, /CONFLITO/);
    const g = cli(['--arquivo', f, '--gravar']); assert.equal(g.status, 1, g.saida); assert.equal(await contar('users'), n);
    const [u] = await um("SELECT password_hash, role FROM users WHERE email = 'ja.existe@exemplo.test'"); assert.equal(u.password_hash, 'x'); assert.equal(u.role, 'CLIENTE');
  });
  await passo('problema na planilha: --gravar não grava NADA; com --so-validas cria só as boas', async () => {
    const f = arq('mista.json', [{ nome: 'Bom Um', nomeFada: 'F', cargo: 'atendente', email: 'bom.um@exemplo.test', whatsapp: '11 98888-0011' },
      { nome: 'Ruim Espaco', nomeFada: 'F', cargo: 'atendente', email: 'ruim espaco@exemplo.test', whatsapp: '11 98888-0012' },
      { nome: 'Cargo Estranho', nomeFada: 'F', cargo: 'chefe', email: 'cargo@exemplo.test', whatsapp: '11 98888-0013' }]);
    const n = await contar('users');
    const a = cli(['--arquivo', f, '--gravar']); assert.equal(a.status, 1); assert.match(a.saida, /Nada foi gravado/); assert.equal(await contar('users'), n);
    const b = cli(['--arquivo', f, '--gravar', '--so-validas']); assert.equal(b.status, 1); assert.match(b.saida, /criadas 1/);
    assert.equal(await contar('users'), n + 1);
  });
  await passo('WhatsApp já usado por outra conta é CONFLITO', async () => {
    await sequelize.query("UPDATE users SET phone = '+55 11 98888-0001' WHERE email = 'ada.admin@exemplo.test'");
    const f = arq('fone.json', [{ nome: 'Novo Fone', nomeFada: 'F', cargo: 'atendente', email: 'novo.fone@exemplo.test', whatsapp: '11 98888-0001' }]);
    const x = cli(['--arquivo', f, '--simular', '--com-banco']); assert.equal(x.status, 1); assert.match(x.saida, /WhatsApp já cadastrado/);
  });

  console.log('Segurança');
  await passo('saída mascarada; recusa produção sem confirmação, legado e envio de e-mail ligado', async () => {
    const x = cli(['--arquivo', ARQ, '--simular', '--com-banco']);
    assert.ok(!x.saida.includes('ada.admin@') && !x.saida.includes('0001'), 'dado pessoal na saída');
    const n = await contar('users');
    for (const env of [{ NODE_ENV: 'production' }, { DB_NAME: 'fadasdobem02' }, { DB_PORT: '3306' }, { GF_EMAIL_ENVIO_ENABLED: 'true' }]) {
      const r = cli(['--arquivo', arq('o.json', [{ nome: 'Z Z', nomeFada: 'Z', cargo: 'atendente', email: 'z.z@exemplo.test', whatsapp: '11 98888-0020' }]), '--gravar'], env);
      assert.equal(r.status, 2, JSON.stringify(env)); assert.match(r.saida, /RECUSADO/);
    }
    assert.equal(await contar('users'), n);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  const { ok, falhas } = resumo();
  console.log(`\nPostgres descartável: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close().catch(() => {});
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(2); });
