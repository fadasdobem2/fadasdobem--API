'use strict';

/**
 * FILHO de scripts/verificar-gf-contas-equipe.js: roda contra o Postgres DESCARTÁVEL (fdb_ceq_*) já migrado, com DB_* só no ambiente deste
 * processo. Executa o comando REAL (`scripts/criar-contas-equipe.js`) como processo filho e confere o efeito no banco.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

const r = (p) => path.join(raiz, p);
const CLI = r('scripts/criar-contas-equipe.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ceq-'));

const CONTAS = [
  { nome: 'Ana Admin', email: 'ana.admin@fadas.test', papel: 'administradora' },
  { nome: 'Bia Assistente', email: 'bia.assistente@fadas.test', papel: 'assistente' },
  { nome: 'Cris Supervisora', email: 'cris.supervisora@fadas.test', papel: 'supervisora', legacyId: '9901' },
  { nome: 'Dani Atendente', email: 'dani.atendente@fadas.test', papel: 'atendente' },
];

const cli = (args, envExtra = {}) => {
  const env = { ...process.env, NODE_ENV: 'test', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', DADOS_TESTE_ENABLED: 'false', JWT_SECRET: process.env.JWT_SECRET || 'segredo-de-teste-local', ...envExtra };
  const p = spawnSync(process.execPath, [CLI, ...args], { cwd: raiz, env, encoding: 'utf8' });
  return { status: p.status, saida: `${p.stdout}${p.stderr}` };
};
const lerCred = (arq) => fs.readFileSync(arq, 'utf8').split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('nome;')).map((l) => { const [nome, email, papel, senha] = l.split(';'); return { nome, email, papel, senha }; });
const modo = (arq) => (fs.statSync(arq).mode & 0o777).toString(8);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { seedAccessCatalog } = require(r('src/rbac/rbac.seed'));
  await sequelize.authenticate();
  await seedAccessCatalog({});
  await criarUsuario('Admin Existente'); // a administradora que assina a operação (auditoria exige um usuário real)
  const um = async (sql, rep) => (await sequelize.query(sql, { replacements: rep }))[0];
  const contar = async () => Number((await um('SELECT COUNT(*) AS n FROM users'))[0].n);
  const ARQ = path.join(tmp, 'contas.json');
  fs.writeFileSync(ARQ, JSON.stringify(CONTAS));
  const antesUsuarios = await contar();
  let senhas = [];

  console.log('Ensaio (padrão)');
  const sEns = path.join(tmp, 'ensaio.csv');
  await passo('ensaio mostra o que faria, não grava conta nem cria o arquivo de credenciais', async () => {
    const x = cli([ARQ, `--saida=${sEns}`]);
    assert.equal(x.status, 0, x.saida); assert.match(x.saida, /ENSAIO/); assert.equal((x.saida.match(/ensaio {4}/g) || []).length, 4);
    assert.equal(await contar(), antesUsuarios); assert.equal(fs.existsSync(sEns), false);
  });

  console.log('Execução');
  const s1 = path.join(tmp, 'cred1.csv');
  let saida1;
  await passo('--executar cria as 4 contas, com o papel certo, ativas e com vínculo de equipe', async () => {
    const x = cli([ARQ, `--saida=${s1}`, '--executar']); saida1 = x.saida;
    assert.equal(x.status, 0, x.saida); assert.match(x.saida, /criadas 4/);
    assert.equal(await contar(), antesUsuarios + 4);
    const l = await um("SELECT u.email, u.is_active, array_agg(r.role_id) AS papeis FROM users u LEFT JOIN access_user_roles r ON r.user_id = u.id WHERE u.email LIKE '%@fadas.test' GROUP BY u.id ORDER BY u.email");
    assert.deepEqual(l.map((c) => [c.email, c.papeis[0], c.is_active]), [['ana.admin@fadas.test', 'admin', true], ['bia.assistente@fadas.test', 'assistente', true], ['cris.supervisora@fadas.test', 'supervisora', true], ['dani.atendente@fadas.test', 'atendente', true]]);
    const [ext] = await um("SELECT e.legacy_id FROM gf_contas_ext e JOIN users u ON u.id = e.user_id WHERE u.email = 'cris.supervisora@fadas.test'");
    assert.equal(ext.legacy_id, '9901');
  });
  await passo('arquivo de credenciais tem permissão 600 e uma linha por conta nova', () => {
    assert.equal(modo(s1), '600'); senhas = lerCred(s1); assert.equal(senhas.length, 4);
    assert.deepEqual(senhas.map((s) => s.email).sort(), CONTAS.map((c) => c.email).sort());
  });
  await passo('senha só como hash bcrypt: o hash confere com a senha do arquivo e não a contém', async () => {
    for (const s of senhas) {
      const [u] = await um('SELECT password_hash FROM users WHERE email = :e', { e: s.email });
      assert.ok(/^\$2[aby]\$/.test(u.password_hash)); assert.ok(!u.password_hash.includes(s.senha)); assert.equal(await bcrypt.compare(s.senha, u.password_hash), true);
    }
  });
  await passo('nenhum segredo no terminal, na auditoria nem em gf_operacoes', async () => {
    const texto = JSON.stringify(await um('SELECT antes, depois, motivo FROM gf_auditoria')) + JSON.stringify(await um('SELECT escopo, chave, hash_corpo, resposta FROM gf_operacoes'));
    for (const s of senhas) { assert.ok(!saida1.includes(s.senha), 'senha no terminal'); assert.ok(!texto.includes(s.senha), 'senha na auditoria/operações'); }
    const aud = await um("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'contas.criar'");
    assert.equal(Number(aud[0].n), 4);
  });
  await passo('as contas entram no GET /accounts do serviço com os papéis certos (equipe)', async () => {
    const store = require(r('src/gestao-fadas/features/contas/contas.store'));
    const l = (await store.lerLinhas()).filter((c) => c.email.endsWith('@fadas.test'));
    assert.deepEqual(l.map((c) => c.perfil).sort(), ['administradora', 'assistente', 'atendente', 'supervisora']);
  });

  console.log('Idempotência');
  const hashes = async () => JSON.stringify(await um("SELECT email, password_hash FROM users WHERE email LIKE '%@fadas.test' ORDER BY email"));
  await passo('repetir NÃO duplica nem troca senha, e não cria arquivo de credenciais', async () => {
    const antes = await hashes(); const s2 = path.join(tmp, 'cred2.csv');
    const x = cli([ARQ, `--saida=${s2}`, '--executar']);
    assert.equal(x.status, 0, x.saida); assert.match(x.saida, /mantidas 4/); assert.match(x.saida, /criadas 0/);
    assert.equal(await contar(), antesUsuarios + 4); assert.equal(await hashes(), antes); assert.equal(fs.existsSync(s2), false);
  });
  await passo('papel diferente do arquivo em conta existente é avisado e NÃO alterado', async () => {
    const outro = path.join(tmp, 'outro.json'); fs.writeFileSync(outro, JSON.stringify([{ ...CONTAS[3], papel: 'supervisora' }]));
    const x = cli([outro, `--saida=${path.join(tmp, 'c3.csv')}`, '--executar']);
    assert.equal(x.status, 0, x.saida); assert.match(x.saida, /NÃO alterado/);
    const [u] = await um("SELECT r.role_id FROM users u JOIN access_user_roles r ON r.user_id = u.id WHERE u.email = 'dani.atendente@fadas.test'");
    assert.equal(u.role_id, 'atendente');
  });
  await passo('--redefinir-senha troca só com a opção, gera nova senha forte, grava no arquivo 600 e encerra sessões', async () => {
    const antes = await hashes(); const s4 = path.join(tmp, 'cred4.csv');
    const ens = cli([ARQ, `--saida=${path.join(tmp, 'e4.csv')}`, '--redefinir-senha']);
    assert.equal(ens.status, 0); assert.equal(await hashes(), antes);
    const x = cli([ARQ, `--saida=${s4}`, '--executar', '--redefinir-senha']);
    assert.equal(x.status, 0, x.saida); assert.match(x.saida, /senhas redefinidas 4/);
    assert.notEqual(await hashes(), antes); assert.equal(modo(s4), '600');
    const novas = lerCred(s4); assert.equal(novas.length, 4);
    for (const n of novas) { const [u] = await um('SELECT password_hash FROM users WHERE email = :e', { e: n.email }); assert.equal(await bcrypt.compare(n.senha, u.password_hash), true); assert.ok(!x.saida.includes(n.senha)); }
    const antiga = senhas[0]; const [u0] = await um('SELECT password_hash FROM users WHERE email = :e', { e: antiga.email });
    assert.equal(await bcrypt.compare(antiga.senha, u0.password_hash), false);
  });

  console.log('Entradas inválidas');
  await passo('papel inválido: nada é gravado (exit 1)', async () => {
    const f = path.join(tmp, 'ruim.json'); fs.writeFileSync(f, JSON.stringify([{ nome: 'X', email: 'x@fadas.test', papel: 'chefe' }, { nome: 'Y', email: 'y@fadas.test', papel: 'atendente' }]));
    const n = await contar(); const x = cli([f, `--saida=${path.join(tmp, 'r.csv')}`, '--executar']);
    assert.equal(x.status, 1); assert.match(x.saida, /papel inválido/); assert.equal(await contar(), n);
  });
  await passo('e-mail repetido no arquivo: recusado (exit 1); e-mail de cliente já existente: PROBLEMA sem gravar', async () => {
    const f = path.join(tmp, 'rep.json'); fs.writeFileSync(f, JSON.stringify([{ nome: 'X', email: 'dup@fadas.test', papel: 'atendente' }, { nome: 'Y', email: 'DUP@fadas.test', papel: 'atendente' }]));
    assert.equal(cli([f, `--saida=${path.join(tmp, 'r2.csv')}`]).status, 1);
    await sequelize.query("INSERT INTO users (id, email, password_hash, role, is_active, created_at, updated_at) VALUES (gen_random_uuid(), 'cliente@fadas.test', 'x', 'CLIENTE', true, now(), now())");
    const g = path.join(tmp, 'cli.json'); fs.writeFileSync(g, JSON.stringify([{ nome: 'Cliente', email: 'cliente@fadas.test', papel: 'atendente' }]));
    const n = await contar(); const x = cli([g, `--saida=${path.join(tmp, 'r3.csv')}`, '--executar']);
    assert.equal(x.status, 1); assert.match(x.saida, /fora da equipe/); assert.equal(await contar(), n);
  });
  await passo('CSV com ponto e vírgula funciona de ponta a ponta', async () => {
    const f = path.join(tmp, 'e.csv'); fs.writeFileSync(f, 'nome;email;papel\nEva Atendente;eva@fadas.test;atendente\n');
    const s = path.join(tmp, 'cs.csv'); const x = cli([f, `--saida=${s}`, '--executar']);
    assert.equal(x.status, 0, x.saida); assert.equal(lerCred(s)[0].email, 'eva@fadas.test'); assert.equal(modo(s), '600');
  });

  console.log('Recusas de segurança');
  await passo('produção sem --confirmo-producao, DADOS_TESTE_ENABLED=true e banco legado são recusados (exit 2) sem gravar', async () => {
    const n = await contar(); const s = path.join(tmp, 'rec.csv');
    for (const [env, args] of [[{ NODE_ENV: 'production' }, []], [{ DADOS_TESTE_ENABLED: 'true' }, []], [{ DB_NAME: 'fadasdobem02' }, []], [{ DB_PORT: '3306' }, []]]) {
      const x = cli([ARQ, `--saida=${s}`, '--executar', ...args], env); assert.equal(x.status, 2, JSON.stringify(env)); assert.match(x.saida, /RECUSADO/);
    }
    assert.equal(await contar(), n); assert.equal(fs.existsSync(s), false);
  });
  await passo('--saida existente ou dentro do repositório é recusada', () => {
    assert.equal(cli([ARQ, `--saida=${s1}`, '--executar']).status, 2);
    assert.equal(cli([ARQ, `--saida=${path.join(raiz, 'cred-teste.csv')}`, '--executar']).status, 2);
    assert.equal(fs.existsSync(path.join(raiz, 'cred-teste.csv')), false);
  });

  console.log('Taróloga do catálogo (em processo, legado SUBSTITUÍDO por lista fixa)');
  await passo('papel tarologa com tarotId cria a conta ligada ao cadastro; repetir não duplica', async () => {
    const tarologos = require(r('src/gestao-fadas/features/cadastros/tarologos.service'));
    tarologos.definirFonteLegado({ listar: async () => [{ idTarologo: 9001, nmuTarologo: 'Tarólogo A', ativo: 1 }], obter: async (id) => (id === 9001 ? { idTarologo: 9001, nmuTarologo: 'Tarólogo A', ativo: 1 } : null) });
    const { executar } = require(r('scripts/apoio-gf-contas-equipe/executar'));
    const c = [{ nome: 'Taró A', email: 'taro.a@fadas.test', papel: 'tarologa', tarotId: '9001' }]; const s = path.join(tmp, 'tar.csv');
    const linhas = []; const a = await executar({ contas: c, args: { executar: true, saida: s }, log: (m) => linhas.push(m), fechar: false });
    assert.equal(a.criada, 1, linhas.join('\n')); assert.equal(modo(s), '600');
    const [t] = await um("SELECT p.tarot_id FROM gf_tarologos_perfil p JOIN specialists sp ON sp.slug = p.conta_slug JOIN users u ON u.id = sp.user_id WHERE u.email = 'taro.a@fadas.test'");
    assert.equal(t.tarot_id, '9001');
    const n = await contar(); const b = await executar({ contas: c, args: { executar: true, saida: path.join(tmp, 'tar2.csv') }, log: () => {}, fechar: false });
    assert.equal(b.criada, 0); assert.equal(b.existente, 1); assert.equal(await contar(), n);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  const { ok, falhas } = resumo();
  console.log(`\nPostgres descartável: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close().catch(() => {});
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(2); });
