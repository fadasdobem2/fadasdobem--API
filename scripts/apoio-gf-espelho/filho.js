'use strict';

/**
 * FILHO de scripts/verificar-gf-espelho.js: Postgres DESCARTÁVEL (fdb_esp_*) já migrado + legado FALSO em memória (`legado-falso.js`).
 * Prova a INTENÇÃO (pendente + chave, na transação da consulta), a falha antes do INSERT, a queda entre o INSERT e o vínculo (órfã),
 * a ADOÇÃO pela reconciliação, a reexecução idempotente e a duplicata evitada. O MySQL de verdade nunca é tocado.
 */

const path = require('path');
const assert = require('assert');
const { raiz, passo, resumo } = require('../apoio-gf-banco-novo/comum');
const { criar } = require('./legado-falso');
const { T, base } = require('../apoio-gf-consulta/cenarios');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres' });
delete process.env.GF_LEGADO_ESCRITA_ENABLED; process.env.GF_LEGADO_MODO = 'copia'; // estes testes são do modo anterior (escrita DEPOIS do commit); o legado primeiro tem o seu (verificar-gf-legado-fonte)
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { emTransacao: emPostgres } = require(r('src/gestao-fadas/novo/escritor'));
  const legado = require(r('src/gestao-fadas/legado-escrita'));
  const store = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.store'));
  const espelho = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.espelho'));
  const intencao = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.intencao'));
  const rec = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.reconciliacao'));
  const falso = criar();
  Object.assign(legado, { espelhoLigado: () => true, emTransacao: falso.emTransacao });
  const linhaPg = async (id) => (await sequelize.query('SELECT id_consulta_legado AS l, legado_estado AS e, legado_detalhe AS d FROM gf_consultas_ext WHERE id = :id', { replacements: { id } }))[0][0];
  let seq = 0;
  /** Lança a consulta como o service faz: grava + intenção na MESMA transação; o espelho vem depois do commit (devolvido, não rodado). */
  const lancar = async (extra = {}) => {
    seq += 1; const item = base({ id: `esp-${seq}`, clientId: `9000${seq}`, ...extra });
    const depois = [];
    await emPostgres(async (ex) => { ex.posCommit = depois; await store.inserir(ex, item, 'Teste', `op-esp-${seq}`); await espelho.agendar(ex, { id: item.id, momento: 'lancamento', item }); });
    return { item, depois };
  };
  const envelhecer = (id) => sequelize.query("UPDATE gf_consultas_ext SET legado_atualizado_em = now() - interval '1 hour' WHERE id = :id", { replacements: { id } });
  const quedaNoVinculo = async (fn) => {
    const original = store.marcarLegado; store.marcarLegado = async () => { throw new Error('processo caiu antes de marcar o vínculo'); };
    try { return await fn(); } finally { store.marcarLegado = original; }
  };

  console.log('Intenção de espelho (antes de qualquer INSERT no legado)');
  await passo('ao lançar, a INTENÇÃO fica no Postgres (pendente + chave) na mesma transação da consulta; o legado ainda não foi tocado', async () => {
    const { item, depois } = await lancar();
    const l = await linhaPg(item.id); assert.equal(l.e, 'pendente'); assert.equal(l.l, null); assert.match(l.d, /#k=9000\d+\|osiris\|2026-11-10 11:00:00\|2026-11-10 11:00:00$/);
    assert.equal(depois.length, 1); assert.equal(falso.estado.linhas.length, 0);
    await depois[0](); const e = await linhaPg(item.id); assert.equal(e.e, 'espelhada'); assert.ok(e.l); assert.equal(falso.estado.linhas.length, 1);
  });
  await passo('consulta já vinculada: nova gravação NÃO volta para pendente; com interruptor desligado nada é marcado', async () => {
    const { item } = await lancar(); await espelho.sincronizar(item.id, 'x'); const antes = await linhaPg(item.id);
    await emPostgres(async (ex) => { ex.posCommit = []; await espelho.agendar(ex, { id: item.id, momento: 'inicio', item }); });
    assert.deepEqual(await linhaPg(item.id), antes);
    legado.espelhoLigado = () => false;
    try { const { item: i2 } = await lancar(); assert.equal((await linhaPg(i2.id)).e, 'nao_espelhada'); } finally { legado.espelhoLigado = () => true; }
  });
  await passo('data inválida não derruba a gravação da consulta: a intenção só não é marcada', async () => {
    seq += 1; const valido = base({ id: `esp-${seq}`, clientId: `9000${seq}` }); const ruim = { ...valido, startedAt: 'ontem', sentToTarologistAt: undefined };
    await emPostgres(async (ex) => { await store.inserir(ex, valido, 'T', `op-esp-${seq}`); assert.equal(await intencao.registrar(ex, valido.id, ruim), false); });
    assert.equal((await linhaPg(valido.id)).e, 'nao_espelhada');
  });

  console.log('Falha ANTES do INSERT');
  await passo('legado cai antes do INSERT: estado erro com a chave preservada, nenhuma linha no legado; a reconciliação insere UMA vez', async () => {
    const { item, depois } = await lancar(); const n0 = falso.estado.linhas.length;
    falso.estado.falharInsert = true; await depois[0](); falso.estado.falharInsert = null;
    const e = await linhaPg(item.id); assert.equal(e.e, 'erro'); assert.match(e.d, /ECONN/); assert.match(e.d, /#k=/); assert.equal(falso.estado.linhas.length, n0);
    await envelhecer(item.id); const x = await rec.reconciliar({ idadeMinutos: 10 });
    assert.equal(x.inseridas, 1); assert.equal((await linhaPg(item.id)).e, 'espelhada'); assert.equal(falso.estado.linhas.length, n0 + 1);
  });

  console.log('Queda ENTRE o INSERT e a marcação do vínculo (órfã)');
  let orfa;
  await passo('o INSERT no legado confirma, o vínculo não é marcado: sobra a linha órfã e o Postgres segue pendente com a chave', async () => {
    const { item, depois } = await lancar(); orfa = item; const n0 = falso.estado.linhas.length;
    await quedaNoVinculo(() => depois[0]());
    const e = await linhaPg(item.id); assert.equal(e.e, 'pendente'); assert.equal(e.l, null); assert.match(e.d, /#k=/); assert.equal(falso.estado.linhas.length, n0 + 1);
  });
  await passo('pendente RECENTE não é reconciliada (pode estar em andamento); pendente antiga é ADOTADA, sem reinserir (duplicata evitada)', async () => {
    const n0 = falso.estado.linhas.length; const insercoes = falso.estado.inserts;
    const cedo = await rec.reconciliar({ idadeMinutos: 10 }); assert.ok(!cedo.adotadas); assert.equal((await linhaPg(orfa.id)).l, null);
    await envelhecer(orfa.id); const x = await rec.reconciliar({ idadeMinutos: 10 });
    assert.equal(x.adotadas, 1); assert.equal(falso.estado.linhas.length, n0, 'não pode haver linha nova'); assert.equal(falso.estado.inserts, insercoes);
    const e = await linhaPg(orfa.id); assert.equal(e.e, 'espelhada'); assert.match(e.d, /^órfã adotada/); assert.equal(Number(e.l), falso.estado.linhas.find((l) => l.idUsuario === Number(orfa.clientId)).idConsulta);
  });
  await passo('REEXECUÇÃO idempotente: reconciliar de novo não examina nada; sincronizar de novo só atualiza a mesma linha', async () => {
    const n0 = falso.estado.linhas.length; const insercoes = falso.estado.inserts;
    const x = await rec.reconciliar({ idadeMinutos: 0 }); assert.equal(x.adotadas + x.inseridas, 0);
    const vinculo = (await linhaPg(orfa.id)).l; await espelho.sincronizar(orfa.id, 'de novo'); await espelho.sincronizar(orfa.id, 'de novo');
    assert.equal((await linhaPg(orfa.id)).l, vinculo); assert.equal(falso.estado.linhas.length, n0); assert.equal(falso.estado.inserts, insercoes);
  });
  await passo('a consulta mudou depois da queda (tarólogo iniciou): a órfã ainda é achada pela chave GUARDADA e vira a linha atualizada', async () => {
    const { item, depois } = await lancar(); const n0 = falso.estado.linhas.length;
    await quedaNoVinculo(() => depois[0]());
    const iniciou = { ...item, awaitingTarologistStart: false, tarologistStartedAt: T(2), startedAt: T(2) };
    await emPostgres(async (ex) => { await store.atualizar(ex, iniciou, 2); });
    await envelhecer(item.id); const x = await rec.reconciliar({ idadeMinutos: 10 });
    assert.equal(x.adotadas, 1); assert.equal(falso.estado.linhas.length, n0 + 1, 'só a órfã, sem duplicata');
    const idv = Number((await linhaPg(item.id)).l);
    assert.equal(falso.estado.linhas.find((l) => l.idConsulta === idv).iniConsulta, '2026-11-10 11:02:00');
  });

  console.log('Duplicata evitada e ambiguidade');
  await passo('linha do legado já vinculada a OUTRA consulta nunca é adotada (mesma chave natural): insere a sua', async () => {
    const a = await lancar({ clientId: '900777' }); await a.depois[0]();
    const b = await lancar({ clientId: '900777', id: 'esp-gemea' }); const n0 = falso.estado.linhas.length;
    await b.depois[0](); const vb = await linhaPg('esp-gemea'); const va = await linhaPg(a.item.id);
    assert.equal(falso.estado.linhas.length, n0 + 1); assert.notEqual(vb.l, va.l); assert.equal(vb.e, 'espelhada');
  });
  await passo('duas linhas soltas com a mesma chave: não decide sozinho (erro "órfã ambígua"), não insere e a reconciliação não repete', async () => {
    const { item, depois } = await lancar({ clientId: '900888' });
    const chave = legado.chave.chaveDaIntencao(item); const copia = (n) => ({ idConsulta: n, idUsuario: 900888, idTarologo: 11, dtConsulta: chave.dtConsulta, iniConsulta: chave.iniConsulta });
    falso.estado.linhas.push(copia(9001), copia(9002)); const n0 = falso.estado.linhas.length; const insercoes = falso.estado.inserts;
    await depois[0](); const e = await linhaPg(item.id);
    assert.equal(e.e, 'erro'); assert.match(e.d, /^órfã ambígua: 2 linhas/); assert.equal(e.l, null); assert.equal(falso.estado.linhas.length, n0); assert.equal(falso.estado.inserts, insercoes);
    await envelhecer(item.id); assert.equal((await rec.candidatas(new Date().toISOString(), 100)).includes(item.id), false);
  });
  await passo('tarólogo sem código no legado: sem_tarologo (com a chave guardada) e nenhuma linha', async () => {
    const n0 = falso.estado.linhas.length; const { item, depois } = await lancar({ tarotId: 'sem-codigo' }); await depois[0]();
    const e = await linhaPg(item.id); assert.equal(e.e, 'sem_tarologo'); assert.match(e.d, /#k=/); assert.equal(falso.estado.linhas.length, n0);
  });
  await passo('reconciliação com o interruptor desligado não examina nem toca o legado', async () => {
    const { item } = await lancar(); await envelhecer(item.id); const n0 = falso.estado.linhas.length; legado.espelhoLigado = () => false;
    try { const x = await rec.reconciliar({ ligado: false }); assert.equal(x.desligado, true); } finally { legado.espelhoLigado = () => true; }
    assert.equal(falso.estado.linhas.length, n0); assert.equal((await linhaPg(item.id)).l, null);
  });

  await sequelize.close();
  const { ok, falhas } = resumo();
  console.log(`\nEspelho (Postgres + legado falso): ${ok} ok, ${falhas.length} falhas`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
