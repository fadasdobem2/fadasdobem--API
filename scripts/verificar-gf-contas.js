'use strict';

/**
 * Verificação da fatia Contas e Configurações (Maturacao/33; padrão em Maturacao/29).
 *   1) OFFLINE (sempre): domínio das contas (senha, e-mail, rótulo de acesso, última administradora), validação das entradas com as
 *      mensagens do front, Boas-vindas contra o OURO do código do front (scripts/apoio-gf-config/ouro-welcome-front.json), flags,
 *      fatia desligada = 404, 401/403/405 e formato de erro da B.
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): cria `fdb_ctc_<aleatório>` em localhost:5432, migra por run-migrations,
 *      roda scripts/apoio-gf-contas/filho.js (HTTP do gate: contas, senha só como hash, 409, corrida, perfis, taróloga, boas-vindas)
 *      e apaga o banco no fim. DB_* só no ambiente dos filhos; nunca lê o .env nem toca em outro banco.
 *   npm run verificar:gf-contas            (completo)       node scripts/verificar-gf-contas.js --offline   (sem banco; entra em verificar:legado)
 */

const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const express = require('express');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const r = (p) => require(path.join(raiz, p));
let ok = 0;
const falhas = [];
async function passo(nome, fn) {
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 240)}`); }
}
const rejeita = (fn, status, codigo) => assert.throws(fn, (e) => e.statusCode === status && e.dados.codigo === codigo, `esperava ${status} ${codigo}`);

async function offline() {
  const dom = r('src/gestao-fadas/_comum/dominio/contas');
  const val = r('src/gestao-fadas/features/contas/contas.validacao');
  const wel = r('src/gestao-fadas/_comum/dominio/welcome');

  console.log('Domínio das contas');
  await passo('senha forte como o front (12+, maiúscula, minúscula, número, símbolo)', () => {
    assert.equal(dom.senhaForte('Abcdefghij1!'), true);
    for (const s of ['Abcdefghi1!', 'abcdefghij1!', 'ABCDEFGHIJ1!', 'Abcdefghijk!', 'Abcdefghij12', '', null]) assert.equal(dom.senhaForte(s), false, String(s));
  });
  await passo('e-mail: mensagens do front para vazio, com espaço e sem formato', () => {
    assert.equal(dom.validarEmail(''), 'Preencha o nome e o usuário ou e-mail.');
    assert.equal(dom.validarEmail('a b@c.co'), 'Confira o usuário ou e-mail informado.');
    assert.equal(dom.validarEmail('semarroba'), 'Confira o usuário ou e-mail informado.');
    assert.equal(dom.validarEmail('ok@fadas.test'), null);
  });
  await passo('nome: espaços repetidos viram um', () => assert.equal(dom.normalizarNome('  Ana   Maria  Souza '), 'Ana Maria Souza'));
  await passo('rótulo de acesso: Ainda não acessou, Agora, Hoje, Ontem e data', () => {
    const agora = new Date('2026-11-10T18:00:00Z'); // 15:00 em São Paulo
    assert.equal(dom.rotuloAcesso(null, agora), 'Ainda não acessou');
    assert.equal(dom.rotuloAcesso('2026-11-10T17:58:00Z', agora), 'Agora');
    assert.equal(dom.rotuloAcesso('2026-11-10T16:48:00Z', agora), 'Hoje, 13:48');
    assert.equal(dom.rotuloAcesso('2026-11-09T22:10:00Z', agora), 'Ontem, 19:10');
    assert.equal(dom.rotuloAcesso('2026-08-20T21:45:00Z', agora), '20/08, 18:45');
  });
  await passo('DTO: tarotId, legacyId e avatar só quando existem; comissão só da taróloga', () => {
    const t = dom.paraConta({ id: 'u', nome: 'T', email: 't@x.co', perfil: 'tarologa', comissao: '30.00', ativo: true, tarot_id: '9001', legacy_id: null, avatar: null, ultimo_login: null });
    assert.deepEqual(t, { id: 'u', name: 'T', email: 't@x.co', role: 'tarologa', commission: '30%', access: 'Ainda não acessou', active: true, tarotId: '9001' });
    const a = dom.paraConta({ id: 'a', nome: 'A', email: 'a@x.co', perfil: 'atendente', ativo: false, ultimo_login: null, legacy_id: '12', avatar: 'data:image/png;base64,AA' });
    assert.equal(a.commission, '—'); assert.equal(a.legacyId, '12'); assert.equal(a.avatar, 'data:image/png;base64,AA'); assert.ok(!('tarotId' in a));
  });
  await passo('última administradora: bloqueia mudar a função ou desativar a única ativa; havendo outra, libera', () => {
    const c = (id, role, active = true) => ({ id, role, active });
    assert.equal(dom.removeUltimaAdmin([c('a', 'administradora'), c('b', 'atendente')], 'a', 'atendente'), true);
    assert.equal(dom.removeUltimaAdmin([c('a', 'administradora'), c('b', 'administradora')], 'a', 'atendente'), false);
    assert.equal(dom.removeUltimaAdmin([c('a', 'administradora'), c('b', 'administradora', false)], 'a', 'atendente'), true);
    assert.equal(dom.removeUltimaAdmin([c('a', 'administradora')], 'a', 'administradora'), false);
    assert.equal(dom.removeUltimaAdmin([c('a', 'administradora')], 'a', 'administradora', false), true);
  });

  console.log('Validação das contas');
  const novo = (x = {}) => ({ operationKey: 'chave-0001', name: 'Ana', email: 'ana@fadas.test', role: 'atendente', password: 'Abcdefghij1!', ...x });
  await passo('criar aceita o corpo certo e normaliza e-mail e nome', () => {
    const v = val.corpoCriar(novo({ name: ' Ana  Souza ', email: 'ANA@Fadas.Test' }));
    assert.equal(v.name, 'Ana Souza'); assert.equal(v.email, 'ana@fadas.test');
  });
  await passo('criar recusa: campo extra, papel desconhecido, chave curta (400) e regras do front (422)', () => {
    rejeita(() => val.corpoCriar(novo({ hash: 'x' })), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoCriar(novo({ role: 'gestora' })), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoCriar(novo({ operationKey: 'curta' })), 400, 'INVALID_INPUT');
    assert.equal(val.corpoCriar(novo({ role: 'tarologa' })).tarotId, undefined); // 'cadastro não encontrado' vem do serviço, depois da senha (ordem do front, Maturacao/44)
    rejeita(() => val.corpoCriar(novo({ tarotId: '9001' })), 400, 'INVALID_INPUT');
    rejeita(() => val.exigirSenhaForte('curta'), 422, 'RULE_VIOLATION'); // a força da senha vem depois do e-mail em uso (ordem do front)
    rejeita(() => val.corpoCriar(novo({ email: 'x' })), 422, 'RULE_VIOLATION');
    rejeita(() => val.corpoCriar(novo({ name: '  ' })), 422, 'RULE_VIOLATION');
    rejeita(() => val.corpoCriar(novo({ avatar: 'javascript:alert(1)' })), 400, 'INVALID_INPUT');
  });
  await passo('taróloga do catálogo exige tarotId e role tarologa', () => {
    const v = val.corpoCriar(novo({ role: 'tarologa', tarotId: '9001' }));
    assert.equal(v.tarotId, '9001');
    rejeita(() => val.corpoCriar(novo({ role: 'tarologa', tarotId: 'a b' })), 400, 'INVALID_INPUT');
  });
  await passo('editar, senha e ativo: revisão obrigatória e tipos', () => {
    rejeita(() => val.corpoEditar({ operationKey: 'chave-0001', name: 'A' }), 400, 'INVALID_INPUT');
    val.corpoEditar({ operationKey: 'chave-0001', expectedRevision: 0, name: 'A', legacyId: '' });
    rejeita(() => val.corpoSenha({ operationKey: 'chave-0001', expectedRevision: 0, password: 'x' }), 422, 'RULE_VIOLATION');
    rejeita(() => val.corpoAtivo({ operationKey: 'chave-0001', expectedRevision: 0, active: 'sim' }), 400, 'INVALID_INPUT');
    rejeita(() => val.idConta('abc'), 404, 'NOT_FOUND');
  });

  console.log('Boas-vindas (ouro do código do front)');
  const ouro = require('./apoio-gf-config/ouro-welcome-front.json');
  await passo(`o padrão do servidor é idêntico ao DEFAULT_WELCOME do front (${ouro.padrao.greetings.length} saudações, ${ouro.padrao.messages.length} mensagens)`, () => assert.deepEqual(wel.padrao(), ouro.padrao));
  const { CENARIOS } = require('./apoio-gf-config/cenarios');
  await passo(`${ouro.cenarios.length} cenários de validateWelcome: mesmo conteúdo ou a mesma mensagem de erro`, () => {
    assert.equal(ouro.cenarios.length, CENARIOS.length);
    for (const [i, c] of CENARIOS.entries()) {
      const esperado = ouro.cenarios[i];
      assert.equal(esperado.nome, c.nome);
      let obtido;
      try { obtido = { conteudo: JSON.parse(JSON.stringify(wel.validar(JSON.parse(JSON.stringify(c.conteudo))))) }; } catch (e) { obtido = { erro: e.message }; }
      if (esperado.erro !== undefined) assert.equal(obtido.erro, esperado.erro, c.nome);
      else assert.deepEqual(obtido.conteudo, esperado.conteudo, c.nome);
    }
  });
  await passo('a tela de entrada recebe só as linhas ativas', () => {
    const c = wel.padrao(); c.messages[0].active = false;
    assert.equal(wel.publico(c).messages.length, c.messages.length - 1);
  });

  console.log('Gate');
  const { criarGate } = r('src/gestao-fadas/gate');
  const { contasLigado } = r('src/gestao-fadas/gate/rotas-contas');
  const { configLigado } = r('src/gestao-fadas/gate/rotas-config');
  let sessao = { status: 'absent' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => sessao }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const url = (p) => `http://127.0.0.1:${srv.address().port}/api${p}`;
  const chamar = async (metodo, p, corpoJson) => {
    const resp = await fetch(url(p), { method: metodo, headers: { 'content-type': 'application/json' }, body: corpoJson === undefined ? undefined : JSON.stringify(corpoJson) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, h: resp.headers };
  };
  const antes = { c: process.env.GF_FATIA_CONTAS, f: process.env.GF_FATIA_CONFIG, o: process.env.FADAS_ORIGIN };
  try {
    await passo('flags lidas de GF_FATIA_CONTAS e GF_FATIA_CONFIG (só "true" liga)', () => {
      assert.equal(contasLigado({ GF_FATIA_CONTAS: 'true' }), true); assert.equal(contasLigado({ GF_FATIA_CONTAS: '1' }), false); assert.equal(contasLigado({}), false);
      assert.equal(configLigado({ GF_FATIA_CONFIG: 'true' }), true); assert.equal(configLigado({ GF_FATIA_CONFIG: 'sim' }), false); assert.equal(configLigado({}), false);
    });
    delete process.env.GF_FATIA_CONTAS; delete process.env.GF_FATIA_CONFIG;
    await passo('fatia desligada: /accounts 404 NOT_FOUND antes da sessão; /welcome editor e PUT seguem 503 como antes', async () => {
      const a = await chamar('GET', '/accounts'); assert.equal(a.status, 404); assert.equal(a.j.error.code, 'NOT_FOUND'); assert.equal(a.h.get('cache-control'), 'no-store');
      assert.equal((await chamar('POST', '/accounts', {})).status, 404);
      assert.equal((await chamar('GET', '/welcome?editor=1')).status, 503);
      assert.equal((await chamar('PUT', '/welcome', { revision: 0, content: {} })).status, 503);
      const p = await chamar('GET', '/welcome'); assert.equal(p.status, 200); assert.equal(p.j.revision, 0);
    });
    process.env.GF_FATIA_CONTAS = 'true'; process.env.GF_FATIA_CONFIG = 'true'; process.env.FADAS_ORIGIN = 'http://127.0.0.1:5180';
    await passo('contas ligadas, sem sessão: 401 SESSION_REQUIRED; método errado: 405 com Allow (antes da sessão)', async () => {
      const a = await chamar('GET', '/accounts'); assert.equal(a.status, 401); assert.equal(a.j.error.code, 'SESSION_REQUIRED');
      const b = await chamar('DELETE', '/accounts'); assert.equal(b.status, 405); assert.equal(b.h.get('allow'), 'GET, POST');
      const c = await chamar('GET', '/accounts/00000000-0000-4000-8000-000000000000/password'); assert.equal(c.status, 405); assert.equal(c.h.get('allow'), 'POST');
    });
    await passo('perfil que não é administradora: 403 ACCESS_DENIED em /accounts', async () => {
      for (const role of ['assistente', 'supervisora', 'atendente']) {
        sessao = { status: 'identity', identity: { userId: 'u-1', role, displayName: 'X' }, sessionId: 's1' };
        const a = await chamar('GET', '/accounts'); assert.equal(a.status, 403, role); assert.equal(a.j.error.code, 'ACCESS_DENIED');
      }
    });
    await passo('boas-vindas ligadas: editor e PUT sem sessão 403 com needsSignIn; perfil sem permissão 403', async () => {
      sessao = { status: 'absent' };
      const a = await chamar('GET', '/welcome?editor=1'); assert.equal(a.status, 403); assert.equal(a.j.needsSignIn, true);
      const b = await chamar('PUT', '/welcome', { revision: 0, content: {} }); assert.equal(b.status, 403);
      sessao = { status: 'identity', identity: { userId: 'u-1', role: 'atendente', displayName: 'X' }, sessionId: 's1' };
      const c = await chamar('GET', '/welcome?editor=1'); assert.equal(c.status, 403); assert.equal(c.j.error, 'Esta conta não tem permissão administrativa para editar os textos.');
      assert.equal((await chamar('PATCH', '/welcome', {})).status, 405);
    });
  } finally {
    for (const [k, v] of [['GF_FATIA_CONTAS', antes.c], ['GF_FATIA_CONFIG', antes.f], ['FADAS_ORIGIN', antes.o]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    srv.close();
  }
}

async function comBanco() {
  const banco = pg.nomeBanco('ctc');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-contas', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_ctc_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_ctc_* restante).');
  }
  return codigo;
}

(async () => {
  await offline();
  console.log(`\nOffline: ${ok} ok, ${falhas.length} falhas`);
  if (falhas.length) process.exit(1);
  if (process.argv.includes('--offline')) process.exit(0);
  process.exit(await comBanco());
})().catch((e) => { console.error(e); process.exit(2); });
