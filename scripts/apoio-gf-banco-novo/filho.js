'use strict';

/**
 * FILHO de scripts/verificar-gf-banco-novo.js: roda contra o Postgres DESCARTÁVEL (fdb_gf_*) já migrado, com DB_* só no
 * ambiente deste processo. Prova o banco novo ponta a ponta: esquema, allowlist, executor (transação, ensaio, duplicidade),
 * store do repasse, leitores, auditoria, idempotência (gf_operacoes), welcome; depois o HTTP e o diferencial (outros arquivos).
 */

const path = require('path');
const assert = require('assert');
const { raiz, conferir, passo, resumo, criarUsuario, contagens, TABELAS_GF } = require('./comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true' });
const r = (p) => path.join(raiz, p);

// O tarólogo e a cliente moram no legado (MySQL), que aqui NÃO existe: `lendo` devolve models falsos só para a existência.
const TAROLOGOS = new Set([7, 4256]);
const CLIENTES = new Set([900013]);
const legadoPath = require.resolve(r('src/gestao-fadas/_comum/legado'));
const legadoOriginal = require(legadoPath);
const modelosLegado = {
  LegadoTarologo: { findOne: async ({ where }) => (TAROLOGOS.has(where.idTarologo) ? { idTarologo: where.idTarologo } : null) },
  LegadoUsuario: { findAll: async ({ where }) => (CLIENTES.has(where.id) ? [{ id: where.id }] : []) },
};
require.cache[legadoPath].exports = { ...legadoOriginal, lendo: async (fn) => fn(modelosLegado) };

const { sequelize } = require(r('src/config/database'));
const escritor = require(r('src/gestao-fadas/novo/escritor'));
const bn = require(r('src/gestao-fadas/novo/banco-novo'));
const { traduzir, motivoDeRecusa } = require(r('src/gestao-fadas/novo/traducao-sql'));
const { criarAuditoria } = require(r('src/gestao-fadas/_comum/auditoria'));
const { criarRepasseEscrita } = require(r('src/gestao-fadas/features/repasse/escrita/fabrica'));
const { entradaDaAbertura } = require(r('src/gestao-fadas/features/repasse/escrita/entrada'));
const validacao = require(r('src/gestao-fadas/features/repasse/repasse.validacao'));
const leitor = require(r('src/gestao-fadas/features/repasse/repasse.service'));
const { contaExisteNaA } = require(r('src/gestao-fadas/novo/contas'));
const operacoes = require(r('src/gestao-fadas/novo/operacoes'));
const welcome = require(r('src/gestao-fadas/novo/welcome'));

const recusado = (sql) => motivoDeRecusa(sql) !== null;
const contarGf = async () => (await sequelize.query("SELECT COUNT(*) AS n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relname LIKE 'gf\\_%'"))[0][0].n;

async function esquema() {
  const [tabelas] = await sequelize.query("SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'gf\\_%'");
  const nomes = tabelas.map((x) => x.t);
  // Uma tabela por model registrado (a lista cresce a cada fatia: horários 3, presença 3, agenda 3...).
  const esperadas = require(path.join(raiz, 'src', 'gestao-fadas', 'novo', 'models')).fabricas.length;
  await passo(`${esperadas} tabelas gf_* no Postgres (uma por model) e nenhuma gf_auth_*`, async () => {
    assert.equal(nomes.length, esperadas, nomes.join(','));
    assert.ok(!nomes.some((n) => n.startsWith('gf_auth_')));
    for (const n of ['gf_operacoes', 'gf_welcome', 'gf_auditoria', 'gf_tarologos_ext']) assert.ok(nomes.includes(n), n);
  });
  await passo('quem assina tem FK real para users(id)', async () => {
    const [f] = await sequelize.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE contype='f' AND pg_get_constraintdef(oid) LIKE '%REFERENCES users(id)%'");
    assert.ok(f.length >= 10, `${f.length} FKs`);
  });
  await passo('migração idempotente: rodar de novo não falha nem muda nada', async () => {
    const antes = await contarGf();
    await require(r('migrations/20261030120000-gestao-fadas-banco-novo')).up({ sequelize });
    assert.equal(antes, await contarGf());
  });
}

async function allowlist() {
  await passo('allowlist: só INSERT/UPDATE/SELECT em gf_*; DELETE, DDL, users, várias instruções e FOR UPDATE fora de gf_ recusados', async () => {
    for (const sql of ['DELETE FROM gf_auditoria', 'DROP TABLE gf_auditoria', 'UPDATE users SET role = 1', 'INSERT INTO users (id) VALUES (1)', 'SELECT * FROM users',
      'SELECT id FROM users FOR UPDATE', 'SELECT 1; SELECT 2', 'TRUNCATE gf_auditoria', 'SELECT pg_sleep(5)', 'INSERT INTO gf_welcome (id) VALUES (1) ON DUPLICATE KEY UPDATE id = 1',
      'SELECT LAST_INSERT_ID()', 'SELECT id FROM gf_welcome FOR SHARE', 'UPDATE gf_welcome SET revisao = 1 WHERE 1=1; DELETE FROM x']) {
      assert.ok(recusado(sql), `deveria recusar: ${sql}`);
    }
    for (const sql of ['INSERT INTO gf_welcome (id) VALUES (?)', 'UPDATE gf_welcome SET revisao = 2 WHERE id = ?', 'SELECT id FROM gf_welcome WHERE id = ? FOR UPDATE', 'SAVEPOINT ens_1', 'COMMIT']) {
      assert.equal(motivoDeRecusa(sql), null, sql);
    }
  });
  await passo('tradução: ? vira $n fora de literais, crases saem, INSERT IGNORE vira ON CONFLICT DO NOTHING', async () => {
    const t = traduzir("INSERT IGNORE INTO `gf_welcome` (id, conteudo) VALUES (?, '?')", (m) => new Error(m));
    assert.equal(t.texto, "INSERT INTO gf_welcome (id, conteudo) VALUES ($1, '?') ON CONFLICT DO NOTHING");
    assert.equal(t.n, 1);
  });
}

async function executor() {
  const uid = await criarUsuario('Executor Teste');
  const fato = (extra = {}) => ({ actorUserId: uid, actorRole: 'administradora', action: 'teste.exec', entity: 'teste', entityId: 'e1', after: { a: 1 }, ...extra });
  await passo('executor: comando recusado pela allowlist nem chega ao banco', async () => {
    await assert.rejects(() => escritor.executarAvulso('DELETE FROM gf_auditoria'), (e) => e.codigo === 'LEGADO_ESCRITA_RECUSADA');
  });
  await passo('emTransacao confirma e desfaz', async () => {
    const chave = `tx-${Date.now()}`;
    await escritor.emTransacao((ex) => criarAuditoria(ex).adicionarUmaVez(fato(), `${chave}-ok`));
    await assert.rejects(() => escritor.emTransacao(async (ex) => { await criarAuditoria(ex).adicionarUmaVez(fato(), `${chave}-no`); throw new Error('falha'); }));
    const [[l]] = await sequelize.query(`SELECT (SELECT COUNT(*) FROM gf_auditoria WHERE operation_key='${chave}-ok') AS ok, (SELECT COUNT(*) FROM gf_auditoria WHERE operation_key='${chave}-no') AS no`);
    assert.equal(Number(l.ok), 1);
    assert.equal(Number(l.no), 0);
  });
  await passo('duplicidade: Postgres 23505 chega como errno 1062 / ER_DUP_ENTRY', async () => {
    const id = `dup-${Date.now()}`.slice(0, 30);
    await escritor.emTransacao((ex) => ex.execute('INSERT INTO gf_welcome (id, conteudo) VALUES (?, ?)', [id, '{}']));
    const e = await escritor.emTransacao((ex) => ex.execute('INSERT INTO gf_welcome (id, conteudo) VALUES (?, ?)', [id, '{}'])).catch((x) => x);
    assert.equal(e.errno, 1062);
    assert.equal(e.code, 'ER_DUP_ENTRY');
    assert.equal(e.codigoPg, '23505');
    assert.ok(bn.ehDuplicado(e));
  });
  await passo('INSERT IGNORE do store vira ON CONFLICT DO NOTHING (0 linhas na repetição)', async () => {
    const id = `ig-${Date.now()}`.slice(0, 30);
    const [a] = await escritor.executarAvulso('INSERT IGNORE INTO gf_welcome (id, conteudo) VALUES (?, ?)', [id, '{}']);
    const [b] = await escritor.executarAvulso('INSERT IGNORE INTO gf_welcome (id, conteudo) VALUES (?, ?)', [id, '{}']);
    assert.equal(a.affectedRows, 1);
    assert.equal(b.affectedRows, 0);
  });
  await passo('ensaio: tudo some no ROLLBACK, savepoint desfaz só a operação que falhou', async () => {
    const antes = await contagens(sequelize, ['gf_auditoria']);
    const chave = `ens-${Date.now()}`;
    const dentro = await escritor.emEnsaio(async (ex) => {
      await escritor.emTransacao((e2) => criarAuditoria(e2).adicionarUmaVez(fato(), `${chave}-a`));
      await escritor.emTransacao(async (e2) => { await criarAuditoria(e2).adicionarUmaVez(fato(), `${chave}-b`); throw new Error('falha interna'); }).catch(() => {});
      const [linhas] = await ex.query(`SELECT COUNT(*) AS n FROM gf_auditoria WHERE operation_key LIKE '${chave}-%'`);
      return Number(linhas[0].n);
    });
    assert.equal(dentro, 1, 'a operação que falhou foi desfeita; a anterior vale dentro do ensaio');
    assert.deepEqual(await contagens(sequelize, ['gf_auditoria']), antes);
  });
  await passo('auditoria: adicionarUmaVez idempotente por chave; antes/depois (jsonb) voltam como objetos', async () => {
    const aud = criarAuditoria({ execute: escritor.executarAvulso });
    const k = `aud-${Date.now()}`;
    const x = await aud.adicionarUmaVez(fato({ before: { v: 1 } }), k);
    const y = await aud.adicionarUmaVez(fato({ before: { v: 1 } }), k);
    assert.equal(x.id, y.id);
    assert.deepEqual(x.before, { v: 1 });
    assert.deepEqual(x.after, { a: 1 });
    assert.equal(x.actorUserId, uid);
  });
  await passo('contaExisteNaA: usuário sim, UUID desconhecido não, texto que não é UUID nem vai ao banco', async () => {
    assert.equal(await contaExisteNaA(uid), true);
    assert.equal(await contaExisteNaA('00000000-0000-4000-8000-000000000000'), false);
    assert.equal(await contaExisteNaA('conta-1'), false);
  });
  return uid;
}

async function operacoesEWelcome(uid) {
  await passo('gf_operacoes: mesma chave e corpo repete a resposta; corpo diferente é conflito', async () => {
    const chave = { escopo: 'teste', chave: `op-${Date.now()}` };
    let chamadas = 0;
    const faz = (corpo) => escritor.emTransacao((ex) => operacoes.umaVez(ex, { ...chave, corpo }, async () => { chamadas += 1; return { feito: chamadas }; }));
    assert.deepEqual(await faz({ x: 1, y: [1, 2] }), { repetida: false, resposta: { feito: 1 } });
    assert.deepEqual(await faz({ y: [1, 2], x: 1 }), { repetida: true, resposta: { feito: 1 } });
    await assert.rejects(() => faz({ x: 2 }), (e) => e.codigo === 'operation-key-conflict');
    assert.equal(chamadas, 1);
  });
  await passo('gf_welcome: revisão otimista (primeira 1, conflito com revisão velha, sucesso sobe a revisão)', async () => {
    const id = `w-${Date.now()}`.slice(0, 30);
    const g = (revisaoLida, conteudo) => escritor.emTransacao((ex) => welcome.gravar(ex, { id, conteudo, revisaoLida, usuarioId: uid }));
    assert.deepEqual(await g(0, { t: 'oi' }), { revisao: 1 });
    await assert.rejects(() => g(0, { t: 'outra' }), (e) => e.codigo === 'revision-conflict');
    assert.deepEqual(await g(1, { t: 'dois' }), { revisao: 2 });
    await assert.rejects(() => g(1, { t: 'velha' }), (e) => e.codigo === 'revision-conflict' && e.revisaoAtual === 2);
    const lido = await escritor.emTransacao((ex) => welcome.ler(ex, id));
    assert.deepEqual([lido.conteudo, lido.revisao, lido.atualizadoPor], [{ t: 'dois' }, 2, uid]);
  });
}

async function repasseNoBanco(uid, nome) {
  const loja = criarRepasseEscrita({
    avulso: escritor.executarAvulso, emTransacao: escritor.emTransacao, contaExiste: contaExisteNaA, legado: { tarologoExiste: async (id) => TAROLOGOS.has(Number(id)) },
  });
  const ator = { accountId: uid, role: 'administradora' };
  const tarotId = '4256';
  const k = (s) => `pg-${Date.now()}-${s}`;
  const recusa = (p, codigo) => assert.rejects(p, (e) => e.codigo === codigo, codigo);
  await passo('percentual grava, repete (mesma chave) e 409 com outro corpo; o leitor vê no Postgres com o nome da conta', async () => {
    const entrada = { operationKey: k('com'), actor: ator, tarotId, rate: '35.00', reason: 'ensaio', effectiveFrom: '2026-10-29 10:00:00' };
    const a = await loja.setCommissionRate(entrada);
    assert.deepEqual(await loja.setCommissionRate(entrada), a);
    await recusa(loja.setCommissionRate({ ...entrada, rate: '40.00' }), 'operation-key-conflict');
    const acordo = await leitor.acordo(tarotId);
    assert.equal(acordo.commission.current, '35.00');
    assert.equal(acordo.commission.history[0].by.displayName, nome);
    assert.equal(acordo.commission.history[0].by.accountId, uid);
  });
  await passo('calendário grava (dias do mês) e aparece no acordo', async () => {
    await loja.setPaymentSchedule({ operationKey: k('cal'), actor: ator, tarotId, schedule: { kind: 'monthdays', days: [5, 20], weekendPolicy: 'next-business-day' }, reason: null, effectiveFrom: '2026-10-29 10:00:00' });
    const acordo = await leitor.acordo(tarotId);
    assert.ok(acordo.schedule.current);
    assert.deepEqual(acordo.schedule.current.days, [5, 20]);
  });
  await passo('CHECK do banco: dias do mês repetidos são recusados pelo Postgres (23514)', async () => {
    await assert.rejects(() => escritor.executarAvulso(
      "INSERT INTO gf_repasse_calendarios (id, tarot_id, tipo, dias_mes, politica_fim_semana, vigente_desde, registrado_por, registrado_em, operation_key) VALUES (?, '1', 'monthdays', '5,5', 'keep', '2026-01-01 00:00:00', ?, 1, ?)",
      [`chk-${Date.now()}`, uid, k('chk')],
    ), (e) => (e.codigoPg || e.code) === '23514' || e.code === '23514');
  });
  const corpo = validacao.corpoAbertura({
    tarotId, lastPayment: { paidOn: '2026-10-01', amount: '100.00', sheetRef: 'L12' }, settledThrough: '2026-10-02T06:00:00', remainingBalance: '50.00',
    migrationCut: '2026-10-05T06:00:00', rate: '30', openAdjustments: [{ kind: 'bonus', amount: '10.00', description: 'ensaio', date: '2026-10-03' }],
    debts: [{ kind: 'loan', remaining: '100.00', sheetRef: 'E5', installments: [{ date: '2026-10-10', amount: '60.00' }, { date: '2026-11-10', amount: '40.00' }] }],
    differences: [{ description: 'ensaio' }], operationKey: k('abre'),
  });
  let aberta;
  await passo('abertura: rascunho grava (dívidas, parcelas, ajustes, pendências) e o leitor devolve como o store', async () => {
    aberta = await loja.draftOpening(entradaDaAbertura(corpo, ator));
    const lida = await leitor.aberturas(tarotId);
    assert.equal(lida.draft.id, aberta.id);
    assert.equal(lida.draft.status, 'rascunho');
    assert.equal(lida.draft.enteredBy.displayName, nome);
    assert.equal(lida.draft.debts.length, 1);
    assert.equal(lida.draft.debts[0].installments.length, 2);
    assert.equal(lida.draft.settledThrough, '2026-10-02T06:00:00');
    assert.equal(lida.draft.remainingBalance, '50.00');
  });
  await passo('abertura: repetir a mesma chave devolve a guardada; segundo rascunho é recusado', async () => {
    assert.deepEqual(await loja.draftOpening(entradaDaAbertura(corpo, ator)), aberta);
    await recusa(loja.draftOpening(entradaDaAbertura({ ...corpo, operationKey: k('abre2') }, ator)), 'draft-exists');
  });
  await passo('abertura: confirmar, confirmar de novo (idempotente), corrigir (revisão 2) e confirmar a correção', async () => {
    const chaveConf = k('conf');
    const c = await loja.confirmOpening({ operationKey: chaveConf, actor: ator, openingId: aberta.id });
    assert.deepEqual(await loja.confirmOpening({ operationKey: chaveConf, actor: ator, openingId: aberta.id }), c);
    const corr = await loja.correctOpening({ ...entradaDaAbertura({ ...corpo, operationKey: k('corr') }, ator), openingId: aberta.id, reason: 'ensaio' });
    assert.equal(corr.revision, 2);
    await loja.confirmOpening({ operationKey: k('conf2'), actor: ator, openingId: corr.id });
    const lida = await leitor.aberturas(tarotId);
    assert.equal(lida.current.revision, 2);
    assert.equal(lida.revisions.length, 2);
  });
  await passo('conta que não é usuário da A recusa antes de gravar; tarólogo ausente do legado idem', async () => {
    const fantasma = { accountId: '00000000-0000-4000-8000-000000000000', role: 'administradora' };
    await recusa(loja.setCommissionRate({ operationKey: k('x1'), actor: fantasma, tarotId, rate: '30.00', reason: null, effectiveFrom: '2026-10-30 10:00:00' }), 'actor-account-missing');
    await recusa(loja.setCommissionRate({ operationKey: k('x2'), actor: ator, tarotId: '123', rate: '30.00', reason: null, effectiveFrom: '2026-10-30 10:00:00' }), 'legacy-id-missing');
  });
  await passo('ensaio do store: criar/confirmar/corrigir numa transação que nunca confirma (contagens iguais)', async () => {
    const antes = await contagens(sequelize, TABELAS_GF);
    await escritor.emEnsaio(async () => {
      const c2 = validacao.corpoAbertura({ ...corpo, tarotId: '7', operationKey: k('e-abre') });
      const ab = await loja.draftOpening(entradaDaAbertura(c2, ator));
      await loja.confirmOpening({ operationKey: k('e-conf'), actor: ator, openingId: ab.id });
      await loja.correctOpening({ ...entradaDaAbertura({ ...c2, operationKey: k('e-corr') }, ator), openingId: ab.id, reason: 'ensaio' });
    });
    assert.deepEqual(await contagens(sequelize, TABELAS_GF), antes);
  });
}

(async () => {
  console.log('Banco novo (Postgres descartável)');
  await sequelize.authenticate();
  require(r('src/models'));
  await esquema();
  await allowlist();
  const uid = await executor();
  await operacoesEWelcome(uid);
  const nome = 'Conta Do Repasse';
  await repasseNoBanco(await criarUsuario(nome), nome);
  const apoio = { conferir, passo, criarUsuario, contagens, TABELAS_GF, sequelize, TAROLOGOS };
  await require('./filho-http').rodar(apoio);
  await require('./diferencial-pg').rodar(apoio);
  const { ok, falhas } = resumo();
  console.log(`\n${ok} conferências ok, ${falhas.length} falhas.`);
  await sequelize.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('ERRO', e); process.exit(2); });
