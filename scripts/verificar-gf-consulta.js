'use strict';

/**
 * Verificação das fatias Consulta 5 a 7 (ciclo da consulta; Maturacao/28 seção 4; padrão em Maturacao/29).
 *   1) OFFLINE (sempre): domínio contra o OURO gerado do front (início, pausa, retomada, término, mais tempo, comissão, limite, relógio,
 *      agenda que nasce da consulta), classificação e conferência das revisões, mapeamento para `tbl_consultas` (datas, minutos,
 *      armadilhas), ALLOWLIST do espelho (recusa DELETE, DDL, outra tabela, várias instruções), espelho desligado, validação das
 *      entradas, flag da fatia, gate desligado = 404, 401 sem sessão, 405 com Allow.
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): cria `fdb_con_<aleatório>` em localhost:5432, migra por run-migrations, roda
 *      scripts/apoio-gf-consulta/filho.js (HTTP do gate: lançar, iniciar, pausar, retomar, término, conferir, corrigir, desfechos,
 *      idempotência, 409, ocupação, relógio do servidor, presença, agenda, perfis, auditoria) e apaga o banco no fim.
 *   npm run verificar:gf-consulta            (completo)       node scripts/verificar-gf-consulta.js --offline   (sem banco; entra em verificar:legado)
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
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 300)}`); }
}
const json = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));

async function offline() {
  const comum = r('src/gestao-fadas/_comum/dominio/consulta-comum');
  const sessao = r('src/gestao-fadas/_comum/dominio/consulta-sessao');
  const revisao = r('src/gestao-fadas/_comum/dominio/consulta-revisao');
  const agendaDom = r('src/gestao-fadas/_comum/dominio/consulta-agenda');
  const legado = r('src/gestao-fadas/legado-escrita');
  const val = r('src/gestao-fadas/features/consultas-ciclo/ciclo.validacao');
  const { montarLancamento } = r('src/gestao-fadas/features/consultas-ciclo/ciclo.lancamento');
  const { CENARIOS, T, base, iniciada } = require('./apoio-gf-consulta/cenarios');
  const ouro = require('./apoio-gf-consulta/ouro-consulta-front.json');
  assert.equal(ouro.cenarios.length, CENARIOS.length, 'ouro desatualizado: rode scripts/gerar-ouro-gf-consulta.js');

  console.log('Ouro do front (cenários do código real)');
  const executar = (c) => {
    switch (c.tipo) {
      case 'iniciar': return { item: sessao.iniciar(c.item, c.tarotId, c.ator, c.agora, [c.item, ...c.outras]) };
      case 'iniciar-equipe': return { item: sessao.iniciarPelaEquipe(c.item, c.tarotId, c.ator, c.agora, [c.item]) };
      case 'pausar': return { item: comum.pausar(c.item, c.ator, c.agora, { perfil: c.perfil, equipe: c.perfil !== 'tarologa', tarotIdProprio: c.tarotIdProprio }) };
      case 'retomar': return { item: comum.retomar(c.item, c.ator, c.agora) };
      case 'termino': return { item: sessao.informarTermino(c.item, c.minutos, c.tarotId, c.ator, c.agora, undefined, c.antecipado, c.opcoes) };
      case 'termino-equipe': return { item: sessao.informarTerminoPelaEquipe(c.item, c.minutos, c.ator, c.agora) };
      case 'mais-tempo': return { item: sessao.pedirMaisTempo(c.item, c.tarotId, c.ator, c.agora) };
      case 'devolver': { const x = sessao.devolverPelaTarologa(c.item, c.entrada, c.tarotId, c.ator, c.agora); return { item: x }; }
      case 'correcao': return { item: sessao.pedirCorrecao(c.item, c.minutos, c.motivo, c.tarotId, c.ator, c.agora) };
      case 'comissao': return { taxa: comum.comissaoParaNova(c.taxa, c.origem) };
      case 'limite': return { limite: comum.limiteDeMinutos(c.minutos, c.perfil) };
      case 'relogio': return { duracao: comum.duracaoNoInstante(c.item, Date.parse(c.agora)) };
      case 'agenda-inicio': return { item: agendaDom.resolverAgenda(c.agenda, c.visita, 'Atendimento', c.agora, false) };
      case 'agenda-fim': return { item: agendaDom.concluirAgenda(c.agenda, c.visita, c.agora) };
      default: throw new Error(`tipo ${c.tipo}`);
    }
  };
  for (let i = 0; i < CENARIOS.length; i += 1) {
    const c = CENARIOS[i]; const esperado = ouro.cenarios[i];
    await passo(`${c.tipo}: ${c.nome}`, () => {
      assert.equal(esperado.nome, c.nome);
      let obtido;
      try { obtido = executar(c); } catch (e) { obtido = { erro: e.message }; }
      assert.deepEqual(json(obtido), json({ ...esperado, nome: undefined, tipo: undefined }).constructor === Object ? stripMeta(esperado) : esperado);
    });
  }
  function stripMeta(e) { const { nome: _n, tipo: _t, ...resto } = e; return json(resto); }

  console.log('Revisão guardada (classificar e conferir)');
  const ctxStaff = { perfil: 'atendente', permissoes: r('src/gestao-fadas/_comum/politica-acesso').permissoesDoPerfil('atendente'), tarotIdProprio: '' };
  const ctxAdm = { perfil: 'administradora', permissoes: r('src/gestao-fadas/_comum/politica-acesso').permissoesDoPerfil('administradora'), tarotIdProprio: '' };
  const ctxTar = { perfil: 'tarologa', permissoes: r('src/gestao-fadas/_comum/politica-acesso').permissoesDoPerfil('tarologa'), tarotIdProprio: 'osiris' };
  const rejeita = (fn, parte) => assert.throws(fn, (e) => (e instanceof comum.RegraConsultaError || e instanceof revisao.PermissaoConsultaError) && (!parte || e.message.includes(parte)), `esperava recusa ${parte || ''}`);
  const encerrada = () => sessao.informarTermino(iniciada(), 30, 'osiris', 'Osiris', T(33), undefined, undefined, {});
  await passo('classifica início, término, pausa, desfecho, anulação, compensação, edição', () => {
    const a = base(); assert.equal(revisao.classificar(a, { ...a, awaitingTarologistStart: false }), 'inicio');
    const i = iniciada(); assert.equal(revisao.classificar(i, sessao.informarTermino(i, 30, 'osiris', 'Osiris', T(33), undefined, undefined, {})), 'termino');
    assert.equal(revisao.classificar(a, comum.pausar(a, 'K', T(1), { perfil: 'atendente', equipe: true })), 'pausa');
    assert.equal(revisao.classificar(i, { ...i, status: 'Devolvida' }), 'desfecho');
    assert.equal(revisao.classificar(i, { ...i, observation: 'x' }), 'edicao');
    const e = encerrada();
    assert.equal(revisao.classificar(e, { ...e, bonusGrant: { minutes: 5, reason: 'Consulta anterior cancelada', grantedBy: 'K', grantedAt: T(40) } }), 'compensacao');
    assert.equal(revisao.classificar(e, { ...e, finishReview: { at: T(40), by: 'K', reportSubmittedAt: e.tarologistFinishReport.submittedAt, reportedMinutes: 30, result: 'approved' }, status: 'Concluída' }), 'conferencia');
  });
  await passo('só administradora anula; erro exige motivo; taróloga não mexe em desfecho da equipe', () => {
    const i = iniciada(); const anulada = { ...i, status: 'Anulada', endedAt: T(10), durationSeconds: 100, audit: [...i.audit, { id: 'x', action: 'Consulta anulada', detail: 'd', actor: 'K', createdAt: T(10) }] };
    rejeita(() => revisao.conferir('desfecho', i, anulada, ctxStaff), 'Somente a administradora');
    assert.equal(revisao.conferir('desfecho', i, anulada, ctxAdm), 'desfecho');
    rejeita(() => revisao.conferir('desfecho', i, { ...anulada, status: 'Erro', errorReason: 'qualquer' }, ctxAdm), 'motivo do erro');
    assert.throws(() => revisao.conferir('desfecho', i, { ...anulada, status: 'Cancelada' }, ctxTar), (e) => e instanceof revisao.PermissaoConsultaError);
  });
  await passo('a revisão guardada não aceita o que tem ação própria (devolução e pedidos da taróloga) nem a taróloga como autora', () => {
    const i = iniciada(); const dev = { ...i, status: 'Devolvida', endedAt: T(5), durationSeconds: 60, tarologistCancellation: { reason: 'Não bateu', note: '', at: T(5), reporterTarotId: 'osiris', reporterName: 'Osiris' }, audit: [...i.audit, { id: 'y', action: 'Consulta devolvida', detail: 'd', actor: 'Osiris', createdAt: T(5) }] };
    assert.equal(revisao.classificar(i, dev), 'cancelamento-taro');
    rejeita(() => revisao.conferir('cancelamento-taro', i, dev, ctxStaff), 'ação própria');
    assert.throws(() => revisao.conferir('desfecho', i, { ...dev, tarologistCancellation: undefined }, ctxTar), (e) => e instanceof revisao.PermissaoConsultaError);
  });
  await passo('invariantes: comissão capturada, início do tarólogo, auditoria só cresce, relato final não some', () => {
    const e = encerrada();
    rejeita(() => revisao.conferir('edicao', e, { ...e, commissionRate: 99 }, ctxStaff), 'comissão');
    rejeita(() => revisao.conferir('edicao', e, { ...e, tarologistStartedAt: T(9) }, ctxStaff), 'início');
    rejeita(() => revisao.conferir('edicao', e, { ...e, audit: [] }, ctxStaff), 'histórico');
    rejeita(() => revisao.conferir('edicao', e, { ...e, tarologistFinishReport: undefined }, ctxStaff), 'já foi encerrada');
    rejeita(() => revisao.conferir('edicao', e, { ...e, status: 'Cancelada' }, ctxStaff), 'não muda a situação');
    rejeita(() => revisao.conferir('desfecho', e, { ...e, clientId: '1', status: 'Devolvida' }, ctxStaff), 'só muda pela edição');
  });
  await passo('correção de tempo refeita no servidor (cobertura e saldo) concorda com o front (ouro do código do front)', () => {
    const { verificar } = require('./apoio-gf-consulta/ouro-correcao');
    const saida = verificar();
    assert.deepEqual(saida.falhas.slice(0, 5), []); assert.ok(saida.ok > 1000, `só ${saida.ok} conferências`);
    console.log(`        ouro correção: ${saida.ok}/${saida.ok} conferências iguais (bônus e complemento incluídos; ${saida.naoPortados} fora)`);
  });
  await passo('correção na conferência: o motivo pode vir só em finishReview.reason (sem readerCorrection), mas é obrigatório', () => {
    const e = encerrada(); const rev = { at: T(40), by: 'K', reportSubmittedAt: e.tarologistFinishReport.submittedAt, reportedMinutes: 30, result: 'corrected' };
    const com = { ...e, status: 'Concluída', finishReview: { ...rev, reason: 'Ajuste' }, audit: [...e.audit, { id: 'z', action: 'Encerramento conferido', detail: 'd', actor: 'K', createdAt: T(40) }] };
    assert.equal(revisao.classificar(e, com), 'correcao-tempo'); assert.equal(revisao.conferir('correcao-tempo', e, com, ctxStaff), 'correcao-tempo');
    rejeita(() => revisao.conferir('correcao-tempo', e, { ...com, finishReview: { ...rev, reason: '  ' } }, ctxStaff), 'Motivo da correção');
  });
  await passo('compensação: um bônus por consulta, só encerrada, motivo válido', () => {
    const e = { ...encerrada(), status: 'Concluída' };
    const comBonus = { ...e, bonusGrant: { minutes: 5, reason: 'Consulta anterior cancelada', grantedBy: 'K', grantedAt: T(40) } };
    assert.equal(revisao.conferir('compensacao', e, comBonus, ctxStaff), 'compensacao');
    rejeita(() => revisao.conferir('compensacao', comBonus, { ...comBonus, bonusGrant: { ...comBonus.bonusGrant, minutes: 6 } }, ctxStaff));
    rejeita(() => revisao.conferir('compensacao', e, { ...comBonus, bonusGrant: { minutes: 5, reason: 'x' } }, ctxStaff), 'motivo do bônus');
  });
  await passo('decisão do cancelamento: só a administradora, só pendente', () => {
    const c = { ...encerrada(), status: 'Cancelada', cancellationReview: { status: 'pending', complaint: 'x', requestedBy: 'K', requestedAt: T(40), readerStatus: 'Concluída' } };
    const paga = { ...c, cancellationReview: { ...c.cancellationReview, status: 'paid' } };
    assert.throws(() => revisao.conferir('decisao-cancelamento', c, paga, ctxStaff), (e) => e instanceof revisao.PermissaoConsultaError);
    assert.equal(revisao.conferir('decisao-cancelamento', c, paga, ctxAdm), 'decisao-cancelamento');
    rejeita(() => revisao.conferir('decisao-cancelamento', c, { ...paga, status: 'Anulada' }, ctxAdm), 'não corresponde');
  });

  console.log('Lançamento (comissão, relógio, ocupação, continuação)');
  const a = { nome: 'Khloe', id: 'u1', perfil: 'atendente' };
  const reg = (extra = {}) => ({ id: 'n1', clientId: '900013', client: 'Cliente Teste', tarotId: 'osiris', tarot: 'Osiris', paymentProfile: 'Pós-paga', channel: 'WhatsApp Áudio', observation: 'x', commissionRate: 99, status: 'Concluída', tarologistFinishReport: { minutes: 1 }, ...extra });
  await passo('o servidor decide estado, instantes, comissão e autor; do navegador só entram os campos permitidos', () => {
    const it = montarLancamento(reg({ status: 'Em curso' }), { a, agora: T(0), abertas: [], origem: undefined, taxa: 35 });
    assert.equal(it.status, 'Em curso'); assert.equal(it.commissionRate, 35); assert.equal(it.startedAt, T(0)); assert.equal(it.sentToTarologistAt, T(0));
    assert.equal(it.awaitingTarologistStart, true); assert.equal(it.attendant, 'Khloe'); assert.equal(it.audit[0].action, 'Consulta criada');
    assert.equal(it.tarologistFinishReport, undefined); assert.deepEqual(it.timeLimit, { kind: 'free' });
  });
  await passo('pré-paga sem tempo máximo é recusada; ocupação da mesma cliente é 409', () => {
    assert.throws(() => montarLancamento(reg({ status: 'Em curso', paymentProfile: 'Pré-paga' }), { a, agora: T(0), abertas: [], taxa: undefined }), (e) => e instanceof comum.RegraConsultaError && e.message.startsWith('Informe o tempo máximo'));
    assert.throws(() => montarLancamento(reg({ status: 'Em curso' }), { a, agora: T(0), abertas: [base({ id: 'c9', tarotId: 'nyx' })], taxa: undefined }), (e) => e.statusCode === 409 && e.dados.codigo === 'OCCUPANCY_CONFLICT');
  });
  await passo('continuação herda a comissão da origem e exige a mesma cliente e tarólogo', () => {
    const origem = base({ id: 'o1', commissionRate: 25 });
    const it = montarLancamento(reg({ status: 'Em curso', continuation: { sourceConsultationId: 'o1' } }), { a, agora: T(0), abertas: [], origem, taxa: 40 });
    assert.equal(it.commissionRate, 25); assert.equal(it.continuation.sourceConsultationId, 'o1');
    assert.throws(() => montarLancamento(reg({ status: 'Em curso', continuation: { sourceConsultationId: 'o1' } }), { a, agora: T(0), abertas: [], origem: base({ id: 'o1', clientId: '1' }), taxa: 40 }), (e) => e instanceof comum.RegraConsultaError);
  });
  await passo('cobertura: tipo conhecido e minutos sãos; complemento exige a consulta de origem da mesma cliente e tarólogo', () => {
    const lanca = (cob, origemCobertura) => montarLancamento(reg({ status: 'Em curso', coverage: cob }), { a, agora: T(0), abertas: [], taxa: undefined, origemCobertura });
    assert.equal(lanca({ kind: 'Cortesia', minutes: 10, registeredBy: 'K', registeredAt: T(0) }).coverage.kind, 'Cortesia');
    for (const ruim of [{ kind: 'Outra', minutes: 1 }, { kind: 'Bônus', minutes: -1 }, { kind: 'Bônus', minutes: 'x' }, { kind: 'Complemento', minutes: 5 }]) assert.throws(() => lanca(ruim), (e) => e instanceof comum.RegraConsultaError);
    assert.throws(() => lanca({ kind: 'Complemento', minutes: 5, sourceConsultationId: 'o1' }, base({ id: 'o1', clientId: '1' })), (e) => e instanceof comum.RegraConsultaError);
    assert.equal(lanca({ kind: 'Complemento', minutes: 5, sourceConsultationId: 'o1' }, base({ id: 'o1' })).coverage.kind, 'Complemento');
  });
  await passo('histórico já encerrado: aceita desfecho com fim válido; recusa fim antes do início e ano absurdo', () => {
    const ok1 = montarLancamento(reg({ status: 'Concluída', awaitingTarologistStart: false, startedAt: T(-60), endedAt: T(-30), durationSeconds: 1800 }), { a, agora: T(0), abertas: [], taxa: undefined });
    assert.equal(ok1.status, 'Concluída'); assert.equal(ok1.durationSeconds, 1800); assert.equal(ok1.tarologistFinishReport, undefined);
    assert.throws(() => montarLancamento(reg({ status: 'Concluída', startedAt: T(-30), endedAt: T(-60), durationSeconds: 60 }), { a, agora: T(0), abertas: [], taxa: undefined }), (e) => e instanceof comum.RegraConsultaError);
    assert.throws(() => montarLancamento(reg({ status: 'Em curso', awaitingTarologistStart: false, startedAt: '1999-01-01T00:00:00.000Z' }), { a, agora: T(0), abertas: [], taxa: undefined }), (e) => e instanceof comum.RegraConsultaError);
  });

  console.log('Espelho no legado (mapeamento, allowlist, desligado)');
  const mp = legado.mapeamento;
  await passo('datas: recusa zero, inválida e ano absurdo; devolve horário de São Paulo', () => {
    assert.equal(mp.dataDoLegado('2026-11-10T14:05:09.000Z', 'x'), '2026-11-10 11:05:09');
    for (const ruim of ['0000-00-00 00:00:00', 'abc', '1970-01-01T00:00:00.000Z', '2999-01-01T00:00:00.000Z', null]) assert.throws(() => mp.dataDoLegado(ruim, 'campo'), mp.MapeamentoError);
  });
  await passo('armadilhas: aberta = fim zero; minutos inteiros; sem 4 bytes; varchar(25); pré-paga 8, pós-paga 1 (provisório); Devolvida marca a observação', () => {
    const aberta = mp.linhaDoLegado(iniciada({ observation: 'oi 🔮 ok', attendant: 'Atendente Com Nome Bem Comprido Demais' }), 7, new Date(T(5)));
    assert.equal(aberta.colunas.fimConsulta, mp.ABERTA); assert.equal(aberta.fechada, false); assert.equal(aberta.colunas.tmpConsulta, 0);
    assert.equal(aberta.colunas.obsConsulta, 'oi  ok'); assert.equal(aberta.colunas.nmuAtendente.length, 25); assert.equal(aberta.colunas.vlDesconto, 0);
    assert.equal(aberta.colunas.idFormaPagto, 1); assert.equal(mp.linhaDoLegado(iniciada({ paymentProfile: 'Pré-paga' }), 7, new Date(T(5))).colunas.idFormaPagto, 8);
    const fechada = mp.linhaDoLegado(iniciada({ status: 'Concluída', endedAt: T(32), durationSeconds: 1801, minuteValue: 2.5 }), 7, new Date(T(40)));
    assert.equal(fechada.fechada, true); assert.equal(fechada.colunas.tmpConsulta, 31); assert.equal(fechada.total, '77.50'); assert.equal(fechada.colunas.fimConsulta, '2026-11-10 11:32:00');
    const dev = mp.linhaDoLegado(iniciada({ status: 'Devolvida', endedAt: T(32), durationSeconds: 1800, observation: 'n' }), 7, new Date(T(40)));
    assert.equal(dev.colunas.tmpConsulta, 0); assert.equal(dev.colunas.obsConsulta, 'n'); assert.equal(dev.total, null);
    const finalizada = mp.linhaDoLegado(iniciada({ status: 'Finalizada pelo tarólogo', endedAt: T(32), durationSeconds: 1800 }), 7, new Date(T(40)));
    assert.equal(finalizada.fechada, false); assert.equal(finalizada.colunas.fimConsulta, mp.ABERTA);
    assert.throws(() => mp.linhaDoLegado(iniciada({ clientId: '0' }), 7), mp.MapeamentoError);
    assert.throws(() => mp.linhaDoLegado(iniciada(), 0), mp.MapeamentoError);
  });
  await passo('allowlist: só INSERT/UPDATE de tbl_consultas e leituras fixas; recusa DELETE, DDL, outra tabela, várias instruções', () => {
    const s = legado.sql;
    for (const boa of [s.INSERT_CONSULTA, s.UPDATE_CONSULTA, s.SELECT_CONSULTA, s.SELECT_TAROLOGO, 'START TRANSACTION', 'ROLLBACK', 'COMMIT']) assert.equal(s.motivoDeRecusa(boa), null, boa);
    for (const ruim of ['DELETE FROM tbl_consultas WHERE idConsulta = 1', 'DROP TABLE tbl_consultas', 'ALTER TABLE tbl_consultas ADD x INT', 'TRUNCATE tbl_consultas',
      'UPDATE usuarios SET saldo = 0', 'INSERT INTO usuarios (id) VALUES (1)', 'UPDATE tbl_consultas SET valor_consulta = 0', `${s.UPDATE_CONSULTA}; DELETE FROM tbl_consultas`,
      `${s.INSERT_CONSULTA} /* x */`, 'SELECT * FROM tbl_consultas', 'UPDATE gf_auditoria SET a = 1', 'INSERT INTO tbl_consultas SELECT * FROM tbl_consultas']) assert.ok(s.motivoDeRecusa(ruim), ruim);
    assert.equal(s.COLUNAS_INSERT.includes('idConsulta'), false); assert.equal(s.COLUNAS_UPDATE.includes('idUsuario'), false); assert.equal(s.COLUNAS_UPDATE.includes('dtManutencao'), false);
  });
  await passo('espelho DESLIGADO por padrão: só "true" liga; transação real recusa; ensaio recusa banco de produção', async () => {
    assert.equal(legado.espelhoLigado({}), false); assert.equal(legado.espelhoLigado({ GF_LEGADO_ESCRITA_ENABLED: 'false' }), false); assert.equal(legado.espelhoLigado({ GF_LEGADO_ESCRITA_ENABLED: '1' }), false); assert.equal(legado.espelhoLigado({ GF_LEGADO_ESCRITA_ENABLED: 'true' }), true);
    const antes = { f: process.env.GF_LEGADO_ESCRITA_ENABLED, h: process.env.LEGADO_DB_HOST, n: process.env.LEGADO_DB_NAME, u: process.env.LEGADO_DB_USER };
    delete process.env.GF_LEGADO_ESCRITA_ENABLED;
    try {
      await assert.rejects(() => legado.emTransacao(async () => 1), (e) => e.codigo === 'ESPELHO_DESLIGADO');
      Object.assign(process.env, { LEGADO_DB_HOST: '127.0.0.1', LEGADO_DB_USER: 'x' });
      for (const nome of ['fadasdobem', 'fadasdobem_producao', 'qualquer']) { process.env.LEGADO_DB_NAME = nome; await assert.rejects(() => legado.emEnsaio(async () => 1), (e) => e.codigo === 'ENSAIO_RECUSADO', nome); }
    } finally { for (const [k, v] of [['GF_LEGADO_ESCRITA_ENABLED', antes.f], ['LEGADO_DB_HOST', antes.h], ['LEGADO_DB_NAME', antes.n], ['LEGADO_DB_USER', antes.u]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  });
  await passo('o agendador do espelho não faz nada com o interruptor desligado', () => {
    const espelho = r('src/gestao-fadas/features/consultas-ciclo/ciclo.espelho');
    const ex = { posCommit: [] }; delete process.env.GF_LEGADO_ESCRITA_ENABLED;
    espelho.agendar(ex, { id: 'c1', momento: 'inicio' });
    assert.equal(ex.posCommit.length, 0);
  });

  console.log('Validação das entradas');
  await passo('forma do lançamento, término e revisão; operationKey de 8 a 128', () => {
    const rec = { id: 'n1', clientId: '900013', client: 'C', tarotId: 'osiris', tarot: 'O', paymentProfile: 'Pós-paga', channel: 'PABX' };
    assert.equal(val.corpoLancar({ operationKey: 'chave-0001', record: rec }).record.id, 'n1');
    for (const ruim of [{ operationKey: 'curta', record: rec }, { operationKey: 'chave-0001' }, { operationKey: 'chave-0001', record: { ...rec, clientId: 'abc' } }, { operationKey: 'chave-0001', record: { ...rec, channel: 'Fax' } }, { operationKey: 'chave-0001', record: { ...rec, paymentProfile: 'x' } }]) assert.throws(() => val.corpoLancar(ruim), (e) => e.statusCode === 400);
    assert.throws(() => val.corpoTermino({ operationKey: 'chave-0001', minutes: 'x' }), (e) => e.statusCode === 400);
    assert.throws(() => val.corpoRevisao({ operationKey: 'chave-0001', expectedVersion: 'nao-e-data', record: { audit: [] } }), (e) => e.statusCode === 400);
  });

  console.log('Gate: flag, 404 desligado, 401, 405');
  const { criarGate } = r('src/gestao-fadas/gate');
  const { consultaLigada } = r('src/gestao-fadas/gate/rotas-consulta');
  let sessaoGate = { status: 'absent' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => sessaoGate }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(`http://127.0.0.1:${srv.address().port}/api${p}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, h: resp.headers };
  };
  const antes = process.env.GF_FATIA_CONSULTA;
  try {
    await passo('flag lida de GF_FATIA_CONSULTA (só "true" liga)', () => {
      assert.equal(consultaLigada({ GF_FATIA_CONSULTA: 'true' }), true); assert.equal(consultaLigada({ GF_FATIA_CONSULTA: '1' }), false); assert.equal(consultaLigada({}), false);
    });
    delete process.env.GF_FATIA_CONSULTA;
    await passo('fatia desligada: /consultations responde 404 NOT_FOUND no formato da B, antes da sessão', async () => {
      const x = await chamar('GET', '/consultations');
      assert.equal(x.status, 404); assert.equal(x.j.error.code, 'NOT_FOUND'); assert.equal(x.h.get('cache-control'), 'no-store');
      assert.equal((await chamar('POST', '/consultations/c1/start', {})).status, 404);
    });
    process.env.GF_FATIA_CONSULTA = 'true';
    await passo('ligada, sem sessão: 401 SESSION_REQUIRED; método errado: 405 com Allow', async () => {
      const a1 = await chamar('GET', '/consultations');
      assert.equal(a1.status, 401); assert.equal(a1.j.error.code, 'SESSION_REQUIRED');
      assert.equal((await chamar('POST', '/consultations')).status, 401);
      const b = await chamar('DELETE', '/consultations');
      assert.equal(b.status, 405); assert.equal(b.h.get('allow'), 'GET, POST');
      assert.equal((await chamar('GET', '/consultations/c1/start')).h.get('allow'), 'POST');
    });
    await passo('a sessão nativa anuncia consultation só com a flag ligada (retrocompatível)', async () => {
      const src = require('fs').readFileSync(path.join(raiz, 'src/gestao-fadas/gate/sessao-nativa.js'), 'utf8');
      assert.ok(/consultaLigada\(env\) \? \{ consultation: true \} : \{\}/.test(src));
    });
  } finally {
    if (antes === undefined) delete process.env.GF_FATIA_CONSULTA; else process.env.GF_FATIA_CONSULTA = antes;
    srv.close();
  }
}

async function comBanco() {
  const banco = pg.nomeBanco('con');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-consulta', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_con_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_con_* restante).');
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
