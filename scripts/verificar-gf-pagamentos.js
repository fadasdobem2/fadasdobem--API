'use strict';

/**
 * Verificação OFFLINE de RECEBIMENTOS do `src/gestao-fadas/features/pagamentos` (sem banco, sem rede).
 * Porta as asserções de `tests/real-receipts-model.test.mjs` (suspiro) para `node:assert` contra o
 * `pagamentos.model.js`, mais a parte de recebimentos de `tests/real-operations-permissions.test.mjs`
 * (a permissão canReadRealOperations da B é `dinheiro.recebimentos` no RBAC da A) e a geração de SQL do service
 * com `sequelize.query` substituído (nada chega a um banco).
 *
 *   node scripts/verificar-gf-pagamentos.js
 */

const assert = require('node:assert/strict');

process.env.LEGADO_DB_HOST = process.env.LEGADO_DB_HOST || '127.0.0.1';
process.env.LEGADO_DB_NAME = process.env.LEGADO_DB_NAME || 'verificacao_offline';
process.env.LEGADO_DB_USER = process.env.LEGADO_DB_USER || 'verificacao';

const model = require('../src/gestao-fadas/features/pagamentos/pagamentos.model');
const { utcLocalToSaoPauloLocal, localOperationalDateKey } = require('../src/gestao-fadas/features/pagamentos/helpers/datas');
const { PageOutOfRange } = require('../src/gestao-fadas/features/pagamentos/helpers/paginacao');
const { sumMoney, moneyToCents, centsToMoney } = require('../src/gestao-fadas/features/pagamentos/helpers/dinheiro');

let total = 0;
const falhas = [];
let fila = Promise.resolve();
// Executa em ordem, aceitando testes síncronos e assíncronos.
function test(nome, fn) {
  total += 1;
  fila = fila.then(async () => {
    try {
      await fn();
      console.log(`  ok  ${nome}`);
    } catch (e) {
      falhas.push(nome);
      console.log(`  FALHOU  ${nome}\n${e.stack}`);
    }
  });
}

const catalogs = { paymentOptions: new Map([['1', 'Pix']]), banks: new Map([['5', 'Banco X']]) };
const row = (id, table, over = {}) => model.readLegacyPayment({
  idPagtoInformado: id, idUsuario: 10, nome_id: 'Marina', vlPagtoInformado: '50.00',
  dtPagtoInformado: '2026-10-21 00:00:00', dt_criado: '2026-10-21 15:00:00', idBanco: 5, idFormaPagto: 1, status: null, id_status_pagto: 2, ...over,
}, table, catalogs);
const inf = (id, over) => row(id, 'tbl_pagtoinformado', over);
const conf = (id, over) => row(id, 'tbl_pagtoconfirmado', over);
const nl = (id, over) => row(id, 'tbl_pagtonaolocalizado', over);
const range = { start: '2026-10-21', end: '2026-10-21' };
const run = (src = {}, extra = {}) => model.buildRealReceipts({ informed: [], confirmed: [], notFound: [], range, by: 'paid', page: 1, ...src, ...extra });
const sit = (status, idStatus) => { const [x] = run({ informed: [inf(1, { status, id_status_pagto: idStatus })] }).receipts; return [x.situation, x.reviewReason]; };
const totals = (r) => [r.summary.confirmedTotal, r.summary.informedTotal];
const toReversed = (a) => [...a].reverse();

test('tabela R5 revista para o informado: a situação sai da concordância dos sinais, e texto vazio não conta', () => {
  for (const s of [null, '', '   ', 'Confirmado', ' CONFIRMADO ']) assert.deepEqual(sit(s, 2), ['confirmado', null], `2/${s}`);
  for (const s of [null, '', 'Informado', 'informado ']) assert.deepEqual(sit(s, 1), ['informado', null], `1/${s}`);
  for (const [s, n] of [['informado', 2], ['Informado', 2], ['confirmado', 1]]) assert.deepEqual(sit(s, n), ['conferir-origem', 'situacao-divergente'], `${n}/${s}`);
  for (const [s, n] of [['bloqueado', 1], ['bloqueado', 2], ['Pendente', 2], ['Pendente', 1], ['pago', 2], ['constructor', 2], ['toString', 1]]) {
    assert.deepEqual(sit(s, n), ['conferir-origem', 'texto-nao-previsto'], `${n}/${s}`);
  }
  // Número fora de 1 e 2 é nomeado primeiro, mesmo com texto também inesperado.
  for (const [s, n] of [[null, 3], [null, null], [null, 0], ['confirmado', 3], ['bloqueado', 7]]) assert.deepEqual(sit(s, n), ['conferir-origem', 'numero-nao-previsto'], `${n}/${s}`);
});

test('totais confirmado e informado à parte; conferir a origem e não localizado fora dos dois, sem os nomes antigos', () => {
  const r = run({
    informed: [inf(1, { status: 'bloqueado', id_status_pagto: 1 }), inf(2, { vlPagtoInformado: '40.00' }), inf(3, { id_status_pagto: 1, vlPagtoInformado: '7.50' }), inf(4, { status: 'informado' })],
    confirmed: [conf(5, { vlPagtoInformado: '0.05' })],
    notFound: [nl(6)],
  });
  assert.deepEqual(r.summary, { confirmedTotal: '40.05', informedTotal: '7.50', counts: { confirmado: 2, informado: 1, 'nao-localizado': 1, 'conferir-origem': 2 } });
  assert.ok(r.receipts.every((x) => (x.situation === 'conferir-origem') === (x.reviewReason !== null)));
});

test('par com mesmo ID, cliente, valor e data é uma operação com as duas origens; com 1 no informado, fica em conferir a origem', () => {
  const r = run({ informed: [inf(7, { status: ' Confirmado ' })], confirmed: [conf(7, { dt_criado: '2026-10-21 16:00:00', status: 'x', id_status_pagto: 9 })] });
  assert.equal(r.receipts.length, 1);
  const [p] = r.receipts;
  assert.deepEqual([p.situation, p.reviewReason, p.key], ['confirmado', null, 'tbl_pagtoinformado:7']);
  // Número e texto crus ficam só para tbl_pagtoinformado, como lidos.
  assert.deepEqual(p.origins.map((o) => [o.table, o.id, o.numericStatus, o.textStatus]), [['tbl_pagtoinformado', '7', '2', ' Confirmado '], ['tbl_pagtoconfirmado', '7', null, null]]);
  assert.deepEqual(totals(r), ['50.00', '0.00']);
  assert.equal(r.summary.counts.confirmado, 1);
  for (const [over, reason] of [[{ id_status_pagto: 1 }, 'situacao-divergente'], [{ id_status_pagto: 1, status: 'informado' }, 'situacao-divergente'],
    [{ status: 'informado' }, 'situacao-divergente'], [{ status: 'Pendente' }, 'texto-nao-previsto'], [{ id_status_pagto: 4 }, 'numero-nao-previsto']]) {
    const d = run({ informed: [inf(8, over)], confirmed: [conf(8)] });
    assert.equal(d.receipts.length, 1, JSON.stringify(over));
    assert.deepEqual([d.receipts[0].situation, d.receipts[0].reviewReason, d.receipts[0].origins.length], ['conferir-origem', reason, 2], JSON.stringify(over));
    assert.deepEqual(totals(d), ['0.00', '0.00']);
    assert.equal(d.receipts[0].launchedAtLocal, '2026-10-21T12:00:00');
  }
});

test('confirmado sem par é confirmado, sem data do lançamento; divergência de cliente, valor ou data gera dois conferir-origem', () => {
  const alone = run({ confirmed: [conf(8)] });
  assert.deepEqual(alone.receipts.map((r) => [r.key, r.situation, r.reviewReason, r.launchedAtLocal, r.launchOperationalDate]), [['tbl_pagtoconfirmado:8', 'confirmado', null, null, null]]);
  assert.equal(alone.receipts[0].origins[0].launchedAtLocal, null);
  assert.deepEqual(totals(alone), ['50.00', '0.00']);
  assert.equal(run({ confirmed: [conf(8)] }, { by: 'launched' }).receipts.length, 0);
  for (const over of [{ idUsuario: 11 }, { vlPagtoInformado: '50.01' }, { dtPagtoInformado: '2026-10-20 00:00:00' }, { vlPagtoInformado: null }, { idUsuario: null }]) {
    const r = run({ informed: [inf(9)], confirmed: [conf(9, over)] }, { range: { start: '2026-10-01', end: '2026-10-31' } });
    assert.equal(r.receipts.length, 2, JSON.stringify(over));
    assert.ok(r.receipts.every((x) => x.situation === 'conferir-origem' && x.reviewReason === 'par-divergente'));
    // A linha informada guarda o próprio lançamento; a confirmada nunca o herda.
    assert.deepEqual(r.receipts.map((x) => [x.key, x.launchedAtLocal]).sort(), [['tbl_pagtoconfirmado:9', null], ['tbl_pagtoinformado:9', '2026-10-21T12:00:00']]);
    assert.deepEqual(totals(r), ['0.00', '0.00']);
  }
});

test('concilia antes de filtrar: par cuja segunda origem cairia fora continua uma operação', () => {
  const r = run({ informed: [inf(7)], confirmed: [conf(7, { dt_criado: '2026-10-25 15:00:00' })] }, { by: 'launched' });
  assert.equal(r.receipts.length, 1);
  assert.equal(r.receipts[0].origins.length, 2);
  // 2 com texto vazio e cópia no confirmado: todo sinal presente diz confirmado.
  assert.deepEqual([r.receipts[0].situation, r.receipts[0].reviewReason], ['confirmado', null]);
});

test('não localizado fica à parte, fora do total, com campos ausentes como null e sem data do lançamento', () => {
  const r = run({ notFound: [nl(3, { idUsuario: null, vlPagtoInformado: null, dtPagtoInformado: '2026-10-21 00:00:00', nome_id: null })] });
  const [x] = r.receipts;
  assert.equal(x.situation, 'nao-localizado'); assert.equal(x.reviewReason, null); assert.equal(x.amount, null); assert.equal(x.clientId, null); assert.equal(x.clientLabel, null); assert.equal(x.clientLabelMissing, true);
  assert.equal(x.launchedAtLocal, null); assert.equal(x.launchOperationalDate, null);
  assert.deepEqual(x.origins.map((o) => [o.numericStatus, o.textStatus, o.launchedAtLocal]), [[null, null, null]]);
  assert.deepEqual(r.summary, { confirmedTotal: '0.00', informedTotal: '0.00', counts: { confirmado: 0, informado: 0, 'nao-localizado': 1, 'conferir-origem': 0 } });
  assert.equal(run({ notFound: [nl(4)] }, { by: 'launched' }).receipts.length, 0);
});

test('data paga nula ou zero-date fica fora de todo recorte e do resumo, nas três origens', () => {
  const zero = '0000-00-00 00:00:00';
  const src = { informed: [inf(1, { dtPagtoInformado: zero }), inf(2, { dtPagtoInformado: null })], confirmed: [conf(3, { dtPagtoInformado: zero })], notFound: [nl(4, { dtPagtoInformado: null }), nl(5, { dtPagtoInformado: zero })] };
  const wide = { start: '0001-01-01', end: '9999-12-31' };
  for (const by of ['paid', 'launched']) {
    const r = run(src, { by, range: wide });
    assert.equal(r.receipts.length, 0, by);
    assert.deepEqual(r.summary, { confirmedTotal: '0.00', informedTotal: '0.00', counts: { confirmado: 0, informado: 0, 'nao-localizado': 0, 'conferir-origem': 0 } }, by);
  }
});

const undated = (src = {}, page = 1) => model.buildUndatedReceipts({ informed: [], confirmed: [], notFound: [], page, ...src });

test('sem data paga: lista própria por origem e chave, com o que falta marcado e o mesmo ID marcado nas duas origens sem juntar', () => {
  const zero = '0000-00-00 00:00:00';
  const r = undated({
    informed: [inf(12, { dtPagtoInformado: zero, id_status_pagto: 1 }), inf(5, { dtPagtoInformado: zero }), inf(9, { dtPagtoInformado: null, dt_criado: null }), inf(20), inf(30, { dtPagtoInformado: zero })],
    confirmed: [conf(5, { dtPagtoInformado: zero }), conf(40, { dtPagtoInformado: zero }), conf(30)],
    notFound: [nl(100, { dtPagtoInformado: null }), nl(5, { dtPagtoInformado: zero }), nl(7)],
  });
  const line = (x) => [x.key, x.situation, x.reviewReason, x.paidOn, x.launchedAtLocal, x.missing, x.sameIdElsewhere];
  assert.deepEqual(r.receipts.map(line), [
    ['tbl_pagtoinformado:5', 'conferir-origem', 'par-divergente', null, '2026-10-21T12:00:00', { paidOn: true, launchedAt: false }, true],
    ['tbl_pagtoinformado:9', 'confirmado', null, null, null, { paidOn: true, launchedAt: true }, false],
    ['tbl_pagtoinformado:12', 'informado', null, null, '2026-10-21T12:00:00', { paidOn: true, launchedAt: false }, false],
    // O gêmeo por ID tem data paga, então não é par: os dois ficam em conferir a origem, e só este é sem data.
    ['tbl_pagtoinformado:30', 'conferir-origem', 'par-divergente', null, '2026-10-21T12:00:00', { paidOn: true, launchedAt: false }, false],
    ['tbl_pagtoconfirmado:5', 'conferir-origem', 'par-divergente', null, null, { paidOn: true, launchedAt: true }, true],
    ['tbl_pagtoconfirmado:40', 'confirmado', null, null, null, { paidOn: true, launchedAt: true }, false],
    ['tbl_pagtonaolocalizado:5', 'nao-localizado', null, null, null, { paidOn: true, launchedAt: true }, false],
    ['tbl_pagtonaolocalizado:100', 'nao-localizado', null, null, null, { paidOn: true, launchedAt: true }, false],
  ]);
  assert.ok(r.receipts.every((x) => x.origins.length === 1));
  // Contagens da lista inteira e nenhuma soma de dinheiro.
  assert.deepEqual(Object.keys(r).sort(), ['counts', 'page', 'receipts']);
  assert.deepEqual(r.counts, { confirmado: 2, informado: 1, 'nao-localizado': 2, 'conferir-origem': 3 });
  assert.deepEqual(r.page, { number: 1, size: 500, totalItems: 8 });
  const dated = run({ informed: [inf(30, { dtPagtoInformado: zero })], confirmed: [conf(30)] });
  assert.deepEqual(dated.receipts.map((x) => [x.key, x.situation, x.reviewReason]), [['tbl_pagtoconfirmado:30', 'conferir-origem', 'par-divergente']]);
});

test('sem data paga: páginas de 500 com a contagem da lista inteira', () => {
  const notFound = [];
  for (let i = 1; i <= 503; i++) notFound.push(nl(i, { dtPagtoInformado: null }));
  const p1 = undated({ notFound: toReversed(notFound) });
  const p2 = undated({ notFound }, 2);
  assert.equal(p1.receipts.length, 500); assert.equal(p2.receipts.length, 3);
  assert.deepEqual(p1.page, { number: 1, size: 500, totalItems: 503 }); assert.equal(p2.page.number, 2);
  assert.deepEqual(p2.counts, p1.counts); assert.equal(p1.counts['nao-localizado'], 503);
  assert.deepEqual(p2.receipts.map((x) => x.key), ['tbl_pagtonaolocalizado:501', 'tbl_pagtonaolocalizado:502', 'tbl_pagtonaolocalizado:503']);
  assert.throws(() => undated({ notFound }, 3), PageOutOfRange);
  assert.deepEqual(undated(), { receipts: [], page: { number: 1, size: 500, totalItems: 0 }, counts: { confirmado: 0, informado: 0, 'nao-localizado': 0, 'conferir-origem': 0 } });
});

test('campos, catálogos e cliente sem nome_id', () => {
  const [a] = run({ informed: [inf(1, { nome_id: null })] }).receipts;
  assert.equal(a.clientLabel, 'Cliente 10'); assert.equal(a.clientLabelMissing, true);
  assert.equal(a.paidOn, '2026-10-21'); assert.equal(a.amount, '50.00');
  assert.deepEqual(a.method, { code: '1', label: 'Pix' }); assert.deepEqual(a.bank, { code: '5', label: 'Banco X' });
  const [b] = run({ informed: [inf(2, { idBanco: 77, idFormaPagto: null })] }).receipts;
  assert.deepEqual(b.bank, { code: '77', label: null }); assert.deepEqual(b.method, { code: null, label: null });
  assert.ok(!('consultationId' in a) && !('linkedConsultationId' in a));
  assert.equal(a.origins[0].numericStatus, '2');
  assert.equal(a.launchedAtLocal, '2026-10-21T12:00:00'); assert.equal(a.origins[0].launchedAtLocal, '2026-10-21T12:00:00');
});

test('dt_criado em UTC convertido para São Paulo, com horário de verão anterior a 2019', () => {
  assert.equal(utcLocalToSaoPauloLocal('2018-01-15T08:30:00'), '2018-01-15T06:30:00');
  assert.equal(utcLocalToSaoPauloLocal('2026-10-21T08:30:00'), '2026-10-21T05:30:00');
  const summer = { start: '2018-01-15', end: '2018-01-15' };
  const r = run({ informed: [inf(1, { dtPagtoInformado: '2018-01-14 00:00:00', dt_criado: '2018-01-15 08:30:00' })] }, { by: 'launched', range: summer });
  assert.equal(r.receipts.length, 1);
  assert.equal(r.receipts[0].launchedAtLocal, '2018-01-15T06:30:00');
  assert.equal(r.receipts[0].launchOperationalDate, '2018-01-15');
  const prev = run({ informed: [inf(1, { dt_criado: '2018-01-15 08:30:00' })] }, { by: 'launched', range: { start: '2018-01-14', end: '2018-01-14' } });
  assert.equal(prev.receipts.length, 0);
  assert.equal(localOperationalDateKey('2026-10-21T05:59:59'), '2026-10-20');
  assert.equal(localOperationalDateKey('2026-10-21T06:00:00'), '2026-10-21');
});

test('filtros paid e launched; pago num dia e lançado no seguinte', () => {
  const x = inf(1, { dtPagtoInformado: '2026-10-20 00:00:00', dt_criado: '2026-10-21 12:00:00' });
  assert.equal(run({ informed: [x] }, { by: 'paid' }).receipts.length, 0);
  assert.equal(run({ informed: [x] }, { by: 'paid', range: { start: '2026-10-20', end: '2026-10-20' } }).receipts.length, 1);
  assert.equal(run({ informed: [x] }, { by: 'launched' }).receipts.length, 1);
  assert.equal(run({ informed: [x] }, { by: 'launched', range: { start: '2026-10-20', end: '2026-10-20' } }).receipts.length, 0);
  const noLaunch = inf(2, { dt_criado: null });
  assert.equal(run({ informed: [noLaunch] }, { by: 'launched' }).receipts.length, 0);
  assert.equal(run({ informed: [noLaunch] }, { by: 'paid' }).receipts.length, 1);
});

test('resumo em centavos sobre o recorte inteiro, paginado em 500 do mais recente ao mais antigo, sem vínculo com consulta', () => {
  const informed = [];
  for (let i = 1; i <= 503; i++) informed.push(inf(i, { vlPagtoInformado: '0.10', dt_criado: `2026-10-21 ${String(10 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00` }));
  const shuffled = toReversed(informed);
  const p1 = run({ informed: shuffled });
  const p2 = run({ informed: shuffled }, { page: 2 });
  assert.equal(p1.receipts.length, 500); assert.equal(p2.receipts.length, 3);
  assert.deepEqual(p1.page, { number: 1, size: 500, totalItems: 503 });
  assert.equal(p1.summary.confirmedTotal, '50.30'); assert.equal(p2.summary.confirmedTotal, '50.30');
  const all = [...p1.receipts, ...p2.receipts].map((r) => r.launchedAtLocal);
  assert.deepEqual(all, [...all].sort().reverse());
  assert.deepEqual(p1.tarologistPayouts, { integrated: false });
  assert.throws(() => run({ informed: shuffled }, { page: 3 }), PageOutOfRange);
  assert.deepEqual(run().page, { number: 1, size: 500, totalItems: 0 });
  assert.deepEqual(p1.range, { ...range, by: 'paid' });
});

test('ordem por pago, do mais recente: data paga, lançamento e chave', () => {
  const r = run({ informed: [inf(2), inf(1), inf(3, { dt_criado: '2026-10-21 09:00:00' })] });
  assert.deepEqual(r.receipts.map((x) => x.key), ['tbl_pagtoinformado:2', 'tbl_pagtoinformado:1', 'tbl_pagtoinformado:3']);
  // O dia pago vem primeiro: pago na véspera, vai depois, mesmo lançado mais tarde.
  const older = inf(4, { dtPagtoInformado: '2026-10-20 00:00:00', dt_criado: '2026-10-21 23:00:00' });
  const two = run({ informed: [inf(2), older] }, { range: { start: '2026-10-20', end: '2026-10-21' } });
  assert.deepEqual(two.receipts.map((x) => x.key), ['tbl_pagtoinformado:2', 'tbl_pagtoinformado:4']);
});

test('dinheiro em centavos inteiros, sem float (money-cents)', () => {
  assert.equal(moneyToCents('12.34'), BigInt(1234));
  assert.equal(centsToMoney(BigInt(-5)), '-0.05');
  assert.equal(sumMoney(['0.10', null, '0.20']), '0.30');
  assert.equal(sumMoney([]), '0.00');
  assert.throws(() => moneyToCents('12.3'));
  // O DOUBLE de tbl_pagtonaolocalizado chega como número; vira texto com duas casas, sem notação científica.
  const [d] = run({ notFound: [nl(1, { vlPagtoInformado: 12.3 })] }).receipts;
  assert.equal(d.amount, '12.30');
});

/* ---------- permissões e rotas (porte do que é de recebimentos em real-operations-permissions.test.mjs) ---------- */

test('RBAC: dinheiro.recebimentos existe no catálogo e as rotas de recebimentos o exigem; rota antiga /:tipo foi substituída', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const pasta = path.join(__dirname, '..', 'src', 'gestao-fadas', 'features', 'pagamentos');
  const fonte = fs.readFileSync(path.join(pasta, 'pagamentos.routes.js'), 'utf8');
  const catalogo = fs.readFileSync(path.join(__dirname, '..', 'src', 'rbac', 'rbac.catalog.js'), 'utf8');
  assert.ok(catalogo.includes("id:'dinheiro.recebimentos'"));
  const router = require('../src/gestao-fadas/features/pagamentos/pagamentos.routes');
  const rotas = router.stack.filter((l) => l.route).map((l) => [Object.keys(l.route.methods).join(), l.route.path, l.route.stack.length]);
  // permissão RBAC + trava de perfil da B (canReadRealOperations) + controller
  assert.deepEqual(rotas, [['get', '/recebimentos/export', 3], ['get', '/recebimentos/sem-data', 3], ['get', '/recebimentos', 3]]);
  assert.equal((fonte.match(/exigirCapacidade\('canReadRealOperations'\)/g) || []).length, 3);
  assert.equal((fonte.match(/requirePermission\('dinheiro\.recebimentos'\)/g) || []).length, 3);
  assert.ok(!fonte.includes("'/:tipo'"));
});

/* ---------- service: SQL gerado com sequelize.query substituído (nenhum banco) ---------- */

test('service: lê só com SELECT, filtros e colunas da B, sem escrita', async () => {
  const { iniciarLegado } = require('../src/models/legado');
  const { ehLeitura } = require('../src/models/legado/somente-leitura');
  const { sequelize } = iniciarLegado();
  const capturadas = [];
  sequelize.query = async (sql) => {
    const texto = typeof sql === 'string' ? sql : sql.query;
    capturadas.push(texto);
    assert.ok(ehLeitura(texto), texto);
    return [];
  };
  const service = require('../src/gestao-fadas/features/pagamentos/pagamentos.service');
  const dto = await service.listar({ start: '2026-10-21', end: '2026-10-22', by: 'paid' });
  assert.deepEqual(Object.keys(dto).sort(), ['page', 'range', 'readAt', 'receipts', 'summary', 'tarologistPayouts', 'today']);
  assert.deepEqual(dto.summary, { confirmedTotal: '0.00', informedTotal: '0.00', counts: { confirmado: 0, informado: 0, 'nao-localizado': 0, 'conferir-origem': 0 } });
  assert.deepEqual(dto.range, { start: '2026-10-21', end: '2026-10-22', by: 'paid' });
  const sqlPago = capturadas.join('\n');
  assert.ok(sqlPago.includes("'2026-10-21 00:00:00'") && sqlPago.includes("'2026-10-23 00:00:00'"), sqlPago);
  assert.ok(sqlPago.includes('tbl_pagtoconfirmado') && sqlPago.includes('tbl_pagtonaolocalizado') && sqlPago.includes('tbl_opcaopagto') && sqlPago.includes('tbl_bancos'));
  capturadas.length = 0;
  await service.listar({ start: '2026-10-21', end: '2026-10-21', by: 'launched' });
  const sqlLanc = capturadas.join('\n');
  assert.ok(sqlLanc.includes("'2026-10-21 08:00:00'") && sqlLanc.includes("'2026-10-22 09:00:00'"), sqlLanc);
  assert.ok(!sqlLanc.includes('FROM `tbl_pagtonaolocalizado`'), 'não localizado nunca cai por lançamento');
  capturadas.length = 0;
  const sem = await service.listarSemDataPaga({});
  assert.deepEqual(Object.keys(sem).sort(), ['counts', 'page', 'readAt', 'receipts']);
  assert.ok(capturadas.join('\n').includes('YEAR('));
  for (const ruim of [{ start: '2026-02-30' }, { by: 'x' }, { page: '0' }, { start: '2026-01-01', end: '2027-01-02' }, { start: ['2026-10-01', '2026-10-02'] }]) {
    await assert.rejects(() => service.listar(ruim), (e) => e.statusCode === 400, JSON.stringify(ruim));
  }
  await assert.rejects(() => service.listar({ page: '2' }), (e) => e.statusCode === 400 && e.dados.codigo === 'INVALID_INPUT');
});

(async () => {
  await fila;
  if (falhas.length) {
    console.log(`\n${falhas.length} de ${total} falharam: ${falhas.join(' | ')}`);
    process.exit(1);
  }
  console.log(`\nverificar-gf-pagamentos: ${total} testes ok`);
  process.exit(0);
})();
