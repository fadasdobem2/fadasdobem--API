'use strict';

/**
 * Verificação OFFLINE (sem banco, sem rede) das Consultas do Gestão Fadas: porta as asserções de
 * `tests/real-consultations-model.test.mjs` e `tests/real-operations-permissions.test.mjs` (a parte de consultas) da B
 * contra `src/gestao-fadas/features/consultas/consultas.model.js`, mais as regras da rota (query) e o WHERE do serviço.
 *
 *   node scripts/verificar-gf-consultas.js
 */

const assert = require('node:assert/strict');

const modelo = require('../src/gestao-fadas/features/consultas/consultas.model');
const { lerConsultaLegado } = require('../src/gestao-fadas/features/consultas/helpers/leitura-legado');
const dinheiro = require('../src/gestao-fadas/features/consultas/helpers/dinheiro');
const { PaginaForaDoIntervalo } = require('../src/gestao-fadas/features/consultas/helpers/pagina');
const { lerQueryConsultas } = require('../src/gestao-fadas/features/consultas/helpers/consulta-http');
const { itensParaExportacao } = require('../src/gestao-fadas/features/consultas/consultas.exportacao');

let ok = 0;
let falhas = 0;
function teste(nome, fn) {
  try {
    fn();
    ok += 1;
    console.log(`  ok  ${nome}`);
  } catch (e) {
    falhas += 1;
    console.log(`  FALHOU  ${nome}\n${e && e.stack}`);
  }
}

const catalogos = { channels: { 7: 'WhatsApp' }, paymentOptions: { 1: 'Pix' } };
let n = 0;
const read = (over = {}) => lerConsultaLegado({
  idConsulta: ++n, idUsuario: 10, idTarologo: 27, nome_id: 'Marina', nmuTarologo: 'Osíris',
  iniConsulta: '2026-10-21 10:00:00', fimConsulta: '2026-10-21 10:20:00', tmpConsulta: 20, valor_consulta: '30.00',
  vlBonus: 0, vlDesconto: 0, abatimento: '0.00', idFormaConsulta: 7, idFormaPagto: 1, ...over,
}, catalogos);
const NOW = '2026-10-21T12:30:00';
const run = (rows, extra = {}) => modelo.montarConsultas({ rows, range: { start: '2026-10-21', end: '2026-10-21' }, nowLocal: NOW, page: 1, ...extra });

teste('05h50 pertence ao dia anterior e 06h10 ao escolhido, com data e horário reais', () => {
  const early = read({ iniConsulta: '2026-10-21 05:50:00', fimConsulta: '2026-10-21 06:10:00' });
  const late = read({ iniConsulta: '2026-10-21 06:10:00', fimConsulta: '2026-10-21 06:30:00' });
  const exact = read({ iniConsulta: '2026-10-21 06:00:00', fimConsulta: '2026-10-21 06:20:00' });
  const r = run([early, late, exact]);
  assert.deepEqual(r.finished.map((c) => c.id), [late.id, exact.id]);
  assert.equal(r.finished[0].startedAtLocal, '2026-10-21T06:10:00');
  assert.equal(r.finished[0].operationalDate, '2026-10-21');
  const prev = run([early], { range: { start: '2026-10-20', end: '2026-10-20' } });
  assert.equal(prev.finished[0].startedAtLocal, '2026-10-21T05:50:00');
  assert.equal(prev.finished[0].operationalDate, '2026-10-20');
});

teste('em curso: fim vazio, zero-date ou minutagem nula; finalizada caso contrário', () => {
  const a = read({ fimConsulta: null });
  const b = read({ fimConsulta: '0000-00-00 00:00:00' });
  const c = read({ tmpConsulta: null });
  const d = read();
  const r = run([a, b, c, d]);
  assert.deepEqual(r.inProgress.map((x) => x.id), [a.id, b.id, c.id]);
  assert.ok(r.inProgress.every((x) => x.situation === 'em-curso'));
  assert.deepEqual(r.finished.map((x) => x.id), [d.id]);
  assert.equal(r.finished[0].situation, 'finalizada');
});

teste('abertas desde antes: todas, sem limite de dias, só quando o intervalo inclui hoje', () => {
  const old = read({ iniConsulta: '2020-01-02 09:00:00', fimConsulta: null });
  const yesterday = read({ iniConsulta: '2026-10-20 22:00:00', fimConsulta: null });
  const closedBefore = read({ iniConsulta: '2026-10-20 22:00:00' });
  const r = run([yesterday, old, closedBefore]);
  assert.deepEqual(r.openSinceEarlier.items.map((x) => x.id), [old.id, yesterday.id]);
  assert.ok(r.openSinceEarlier.items.every((x) => x.situation === 'aberta-antes'));
  assert.equal(r.finished.length, 0);
  assert.equal(r.totals.inProgress, 0);
  assert.equal(run([old], { range: { start: '2026-10-15', end: '2026-10-20' } }).openSinceEarlier, null);
  assert.equal(run([old], { range: { start: '2026-10-22', end: '2026-10-23' } }).openSinceEarlier, null);
  assert.equal(run([old], { range: { start: '2026-10-19', end: '2026-10-21' } }).openSinceEarlier.items.length, 1);
});

teste('linha sem início válido e linhas fora do intervalo não entram em grupo', () => {
  const noStart = read({ iniConsulta: null, fimConsulta: null });
  const future = read({ iniConsulta: '2026-10-22 10:00:00', fimConsulta: null });
  const r = run([noStart, future]);
  assert.equal(r.inProgress.length + r.finished.length + r.openSinceEarlier.items.length, 0);
});

teste('elapsedMinutes só nas em curso, arredonda para baixo e usa now por argumento', () => {
  const open = read({ iniConsulta: '2026-10-21 12:00:30', fimConsulta: null });
  const futureStart = read({ iniConsulta: '2026-10-21 13:00:00', fimConsulta: null });
  const before = read({ iniConsulta: '2026-10-20 23:00:00', fimConsulta: null });
  const r = run([open, futureStart, read()]);
  assert.equal(r.inProgress[0].elapsedMinutes, 29);
  assert.equal(r.inProgress[1].elapsedMinutes, 0);
  assert.equal(r.finished[0].elapsedMinutes, null);
  assert.equal(run([before]).openSinceEarlier.items[0].elapsedMinutes, 13 * 60 + 30);
  assert.equal(run([open], { nowLocal: '2026-10-21T12:10:30' }).inProgress[0].elapsedMinutes, 10);
});

teste('minutos e valores como registrados; nulo é não informado e zero é zero', () => {
  const zero = read({ valor_consulta: '0.00', tmpConsulta: 0, vlDesconto: 0, vlBonus: 0, abatimento: '0.00' });
  const missing = read({ valor_consulta: null, vlDesconto: null, vlBonus: null, abatimento: null });
  const r = run([zero, missing]);
  const [m, z] = r.finished;
  assert.equal(z.recordedAmount, '0.00');
  assert.equal(z.recordedMinutes, 0);
  assert.equal(z.discountPercent, 0);
  assert.equal(z.bonusMinutes, 0);
  assert.equal(z.abatement, '0.00');
  assert.equal(m.recordedAmount, null);
  assert.equal(m.discountPercent, null);
  assert.equal(m.bonusMinutes, null);
  assert.equal(m.abatement, null);
  assert.ok(m.issues.length > 0);
});

teste('cliente sem nome_id vira Cliente {id} com a pendência, sem outro nome', () => {
  const r = run([read({ nome_id: null }), read({ idUsuario: 'x', nome_id: null }), read()]);
  const byLabel = r.finished.map((c) => [c.clientLabel, c.clientLabelMissing]);
  assert.deepEqual(byLabel, [['Marina', false], [null, true], ['Cliente 10', true]]);
});

teste('filtro por tarólogo inativo vale também para abertas desde antes; catálogo ausente não esconde', () => {
  const a = read({ idTarologo: 99, nmuTarologo: 'Inativa' });
  const b = read();
  const o = read({ idTarologo: 99, iniConsulta: '2026-10-01 10:00:00', fimConsulta: null });
  const o2 = read({ iniConsulta: '2026-10-01 10:00:00', fimConsulta: null });
  const r = run([a, b, o, o2], { tarotId: '99' });
  assert.deepEqual(r.finished.map((c) => c.id), [a.id]);
  assert.deepEqual(r.openSinceEarlier.items.map((c) => c.id), [o.id]);
  const semCatalogo = modelo.montarConsultas({
    rows: [lerConsultaLegado({ idConsulta: 5, idUsuario: 1, idTarologo: 2, iniConsulta: '2026-10-21 10:00:00', fimConsulta: '2026-10-21 10:10:00', tmpConsulta: 10, idFormaPagto: 8, idFormaConsulta: 3 })],
    range: { start: '2026-10-21', end: '2026-10-21' }, nowLocal: NOW, page: 1,
  });
  assert.deepEqual(semCatalogo.finished[0].paymentOption, { code: '8', label: null });
  assert.deepEqual(semCatalogo.finished[0].channel, { code: '3', label: null });
});

teste('totais somam só as finalizadas do recorte inteiro, em centavos; as sem fim ficam contadas à parte, fora da soma mesmo com valor', () => {
  const rows = [read({ valor_consulta: '0.10', tmpConsulta: 1 }), read({ valor_consulta: '0.20', tmpConsulta: 2 }), read({ valor_consulta: null, tmpConsulta: 4 }),
    read({ fimConsulta: null, valor_consulta: '10.05', tmpConsulta: null }), read({ fimConsulta: null, valor_consulta: null }),
    read({ iniConsulta: '2026-10-01 10:00:00', fimConsulta: null, valor_consulta: '999.00' })];
  const r = run(rows);
  assert.deepEqual(r.totals, { inProgress: 2, openSinceEarlier: 1, finished: 3, recordedAmount: '0.30', recordedMinutes: 7, missingAmount: 1, missingMinutes: 0 });
  assert.equal(run(rows, { range: { start: '2026-10-15', end: '2026-10-20' } }).totals.openSinceEarlier, 0);
});

teste('em andamento (D10): o zero gravado numa consulta sem fim vem nulo; valor diferente de zero vem como registrado', () => {
  const zeroOpen = read({ fimConsulta: null, valor_consulta: '0.00' });
  const paidOpen = read({ fimConsulta: '0000-00-00 00:00:00', valor_consulta: '15.00' });
  const noMinutes = read({ tmpConsulta: null, valor_consulta: 0 });
  const missingOpen = read({ fimConsulta: null, valor_consulta: null });
  const zeroBefore = read({ iniConsulta: '2026-10-20 22:00:00', fimConsulta: null, valor_consulta: '0.00' });
  const zeroDone = read({ valor_consulta: '0.00' });
  const missingDone = read({ valor_consulta: null });
  const paidDone = read({ valor_consulta: '30.00' });
  const r = run([zeroOpen, paidOpen, noMinutes, missingOpen, zeroBefore, zeroDone, missingDone, paidDone]);
  const state = (item) => [item.id, item.recordedAmount, item.amountState];
  assert.deepEqual(r.inProgress.map(state), [[zeroOpen.id, null, 'em-andamento'], [paidOpen.id, '15.00', 'em-andamento'],
    [noMinutes.id, null, 'em-andamento'], [missingOpen.id, null, 'em-andamento']]);
  assert.deepEqual(r.openSinceEarlier.items.map(state), [[zeroBefore.id, null, 'em-andamento']]);
  // Uma consulta finalizada mantém o seu zero (FR-010).
  assert.deepEqual(r.finished.map(state).sort(), [[zeroDone.id, '0.00', 'registrado'], [missingDone.id, null, 'nao-informado'], [paidDone.id, '30.00', 'registrado']].sort());
  assert.equal(r.totals.missingAmount, 1);
});

teste('modalidade pela tabela de evidências: pre só com o código 8 de idFormaPagto, nunca pos', () => {
  const codes = [null, ...Array.from({ length: 13 }, (_, i) => i)];
  const rows = codes.flatMap((code) => [read({ idFormaPagto: code }), read({ idFormaPagto: code, fimConsulta: null, valor_consulta: '0.00' }),
    read({ idFormaPagto: code, iniConsulta: '2026-10-01 10:00:00', fimConsulta: null })]);
  const r = run(rows);
  const all = [...r.finished, ...r.inProgress, ...r.openSinceEarlier.items];
  assert.equal(all.length, codes.length * 3);
  for (const item of all) assert.equal(item.modality, item.paymentOption.code === '8' ? 'pre' : null, `código ${item.paymentOption.code}`);
  assert.ok(all.every((item) => item.modality !== 'pos'));
});

teste('finished paginado em 500 do início mais recente ao mais antigo, com inProgress inteiro', () => {
  const rows = [];
  for (let i = 0; i < 503; i++) {
    rows.push(read({ iniConsulta: `2026-10-21 ${String(6 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`, fimConsulta: '2026-10-21 23:00:00', tmpConsulta: 1, valor_consulta: '0.01' }));
  }
  for (let i = 0; i < 3; i++) rows.push(read({ fimConsulta: null, valor_consulta: '0.00' }));
  const shuffled = rows.slice().reverse();
  const p1 = run(shuffled);
  const p2 = run(shuffled, { page: 2 });
  assert.equal(p1.finished.length, 500);
  assert.equal(p2.finished.length, 3);
  assert.equal(p1.inProgress.length, 3);
  assert.equal(p2.inProgress.length, 3);
  assert.deepEqual(p1.page, { number: 1, size: 500, totalItems: 503 });
  assert.equal(p2.page.number, 2);
  assert.equal(p1.totals.recordedAmount, '5.03');
  assert.equal(p2.totals.recordedAmount, '5.03');
  const starts = [...p1.finished, ...p2.finished].map((c) => c.startedAtLocal);
  assert.deepEqual(starts, [...starts].sort().reverse());
  assert.throws(() => run(shuffled, { page: 3 }), PaginaForaDoIntervalo);
});

teste('página 1 vazia é válida; mesma hora ordena pelo id numérico, do maior ao menor', () => {
  const r = run([]);
  assert.deepEqual(r.page, { number: 1, size: 500, totalItems: 0 });
  assert.deepEqual(r.totals, { inProgress: 0, openSinceEarlier: 0, finished: 0, recordedAmount: '0.00', recordedMinutes: 0, missingAmount: 0, missingMinutes: 0 });
  const rows = [read({ idConsulta: 100 }), read({ idConsulta: 9 })];
  assert.deepEqual(run(rows).finished.map((c) => c.id), ['100', '9']);
});

teste('dinheiro em centavos sem ponto flutuante', () => {
  assert.equal(dinheiro.dinheiroParaCentavos('123.45'), BigInt(12345));
  assert.equal(dinheiro.dinheiroParaCentavos('-0.05'), BigInt(-5));
  assert.equal(dinheiro.centavosParaDinheiro(BigInt(-5)), '-0.05');
  assert.equal(dinheiro.centavosParaDinheiro(BigInt(12345)), '123.45');
  assert.equal(dinheiro.centavosParaDinheiro(BigInt(0)), '0.00');
  assert.equal(dinheiro.somarDinheiro(['0.10', '0.20', null]), '0.30');
  assert.equal(dinheiro.somarDinheiro(['99999999999999999.99', '0.01']), '100000000000000000.00');
});

// real-operations-permissions.test.mjs, só o que é de Consultas: `canReadRealOperations` por função.
teste('permissão de leitura real (canReadRealOperations): só administradora e assistente', () => {
  const roles = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];
  const esperado = [true, true, false, false, false];
  roles.forEach((role, i) => assert.equal(modelo.podeLerOperacoesReais(role), esperado[i], `canReadRealOperations ${role}`));
});

// Regras da rota (real-consultations-http.server.ts + real-access.server.ts), sem Express.
const invalido = (q) => assert.throws(() => lerQueryConsultas(q, '2026-10-21'), (e) => e.statusCode === 400 && e.dados && e.dados.codigo === 'INVALID_INPUT');
teste('rota: start/end/tarotId/page, padrões, repetido, período máximo de 366 dias', () => {
  assert.deepEqual(lerQueryConsultas({}, '2026-10-21'), { start: '2026-10-21', end: '2026-10-21', page: 1 });
  assert.deepEqual(lerQueryConsultas({ start: '2026-10-01', end: '2026-10-21', tarotId: '99', page: '2', outro: 'x' }, '2026-10-21'),
    { start: '2026-10-01', end: '2026-10-21', tarotId: '99', page: 2 });
  assert.deepEqual(lerQueryConsultas({ start: '2025-10-21', end: '2026-10-21' }, '2026-10-21').start, '2025-10-21'); // 366 dias
  invalido({ start: '2025-10-20', end: '2026-10-21' }); // 367 dias
  invalido({ start: '2026-10-22', end: '2026-10-21' });
  invalido({ start: '2026-02-30' });
  invalido({ start: '' });
  invalido({ start: ['2026-10-21', '2026-10-21'] });
  invalido({ tarotId: '007' });
  invalido({ tarotId: '0' });
  invalido({ tarotId: '2147483648' });
  invalido({ tarotId: 'abc' });
  invalido({ page: '0' });
  invalido({ page: '01' });
  invalido({ page: '1.5' });
  invalido({ page: '9007199254740993' });
});

teste('serviço: WHERE do intervalo e das abertas desde antes (só com hoje no intervalo)', () => {
  const { Op } = require('sequelize');
  const { filtroConsultas, COLUNAS } = require('../src/gestao-fadas/features/consultas/consultas.service');
  const sem = filtroConsultas({ from: 'a', to: 'b', incluiHoje: false });
  assert.deepEqual(sem, { iniConsulta: { [Op.gte]: 'a', [Op.lt]: 'b' } });
  const com = filtroConsultas({ from: 'a', to: 'b', incluiHoje: true });
  assert.equal(com[Op.or].length, 2);
  assert.equal(com[Op.or][1][Op.and][1][Op.or].length, 5);
  assert.deepEqual(COLUNAS, ['idConsulta', 'idUsuario', 'idTarologo', 'iniConsulta', 'fimConsulta', 'tmpConsulta',
    'valor_consulta', 'vlDesconto', 'vlBonus', 'abatimento', 'idFormaConsulta', 'idFormaPagto']);
});

teste('exportação: mesmos itens, na ordem da planilha da B', () => {
  const emCurso = read({ fimConsulta: null });
  const emCursoOutroDia = read({ iniConsulta: '2026-10-20 10:00:00', fimConsulta: null });
  const antes = read({ iniConsulta: '2026-10-01 10:00:00', fimConsulta: null });
  const fim = read();
  const cut = modelo.montarRecorteConsultas({ rows: [fim, antes, emCursoOutroDia, emCurso], range: { start: '2026-10-20', end: '2026-10-21' }, nowLocal: NOW });
  const itens = itensParaExportacao({ cut, today: '2026-10-21' });
  assert.deepEqual(itens.map((i) => [i.group, i.item.id]), [['running', emCurso.id], ['open-in-cut', emCursoOutroDia.id], ['open-before', antes.id], ['finished', fim.id]]);
});

console.log(`\n${ok} verificações passaram, ${falhas} falharam.`);
process.exit(falhas === 0 ? 0 : 1);
