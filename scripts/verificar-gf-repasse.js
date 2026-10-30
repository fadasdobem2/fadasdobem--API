'use strict';

/**
 * Verificação OFFLINE da feature `repasse` do módulo gestao-fadas (sem banco, sem rede). Porta, para `node:assert`,
 * as asserções dos testes da B (suspiro):
 *   tests/real-payout-core.test.mjs            (centavos, half-up, R11/R12, composição, A pagar, dívidas, versão, PO 2026-10-24)
 *   tests/real-payout-agreement-model.test.mjs (acordo: percentual, calendário, histórico)
 *   tests/real-payout-opening-model.test.mjs   (abertura: dinheiro do campo, parcelas, pedido, revisões)
 *   tests/real-payout-parity.test.mjs          (paridade com a v584: o oráculo v584 NÃO existe nesta API; ver abaixo)
 * mais verificações próprias da API A (DTO exato, validação de corpo, somente leitura, rotas).
 *
 *   node scripts/verificar-gf-repasse.js
 *
 * Paridade: o teste da B compara o núcleo com as funções do protótipo v584 (admin-payout-model, tarologist-statement-
 * model, payout-loans...). Esse código não é portado. Aqui ficam: (1) as âncoras escritas à mão e todos os valores
 * literais do teste; (2) invariantes contábeis dia a dia nos mesmos cenários (soma das linhas = saldo, líquido =
 * a pagar - sugestões, saldo devedor = soma dos saldos); (3) a data prevista contra o `nextScheduledPayment` portado
 * (referência independente do núcleo), dia a dia por dois anos. As comparações que dependem do valor numérico da v584
 * (ex.: "162.34" do forecast, v584.proposed) NÃO são reproduzidas.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..', 'src', 'gestao-fadas', 'features', 'repasse');
const core = require(path.join(raiz, 'repasse.core'));
const model = require(path.join(raiz, 'repasse.model'));
const dto = require(path.join(raiz, 'repasse.dto'));
const validacao = require(path.join(raiz, 'repasse.validacao'));
const { readLegacyConsultation } = require(path.join(raiz, 'helpers', 'valores-legado'));
const { nextScheduledPayment } = require(path.join(raiz, 'helpers', 'calendario-pagamento'));
const { shiftDateKey } = require(path.join(raiz, 'helpers', 'datas'));

let ok = 0;
const falhas = [];
const pendentes = [];

/** Registra um caso; roda em sequência (alguns são assíncronos). */
function teste(nome, fn) {
  pendentes.push(async () => {
    try {
      await fn();
      ok += 1;
      console.log(`  ok  ${nome}`);
    } catch (e) {
      falhas.push(nome);
      console.log(`  FALHOU  ${nome}\n        ${String(e && e.stack ? e.stack : e).split('\n').slice(0, 6).join('\n        ')}`);
    }
  });
}

const eq = assert.deepEqual;
const ZERO = 0n;

// =====================================================================================================
// real-payout-core.test.mjs  ->  percentual e base (T036): R11, R12 e data-model seção 4
// =====================================================================================================

let n = 0;
const read = (over = {}) => readLegacyConsultation({
  idConsulta: ++n, idUsuario: 10, idTarologo: 27, nome_id: 'Marina', nmuTarologo: 'Osíris',
  iniConsulta: '2026-10-21 10:00:00', fimConsulta: '2026-10-21 10:20:00', tmpConsulta: 20, valor_consulta: '30.00', vlBonus: 0, vlDesconto: 0, abatimento: '0.00', ...over,
});

// Abertura com quitado_ate no corte das 6h e 30% conferido; histórico como as gf_ o devolvem (hora com espaço).
const opening0 = { settledThrough: '2026-10-20 06:00:00', rate: '30.00' };
const agreement = (history = []) => ({ opening: opening0, history });
const change = (rate, effectiveFrom) => ({ rate, effectiveFrom });
const one = (agr, startedAtLocal, clientId = '10', id = 'c1') => core.consultationRates(agr, [{ id, clientId, startedAtLocal }]).get(id);

teste('core: texto DECIMAL vira centavos inteiros sem ponto flutuante e volta para "123.45"', () => {
  assert.equal(core.moneyToCents('123.45'), BigInt(12345));
  assert.equal(core.centsToMoney(BigInt(12345)), '123.45');
  const max = '999999999999999999.99';
  assert.equal(core.moneyToCents(max), BigInt('99999999999999999999'));
  assert.equal(core.centsToMoney(core.moneyToCents(max)), max);
  assert.equal(core.centsToMoney(core.moneyToCents('-0.05')), '-0.05');
  assert.equal(core.centsToMoney(BigInt(7)), '0.07');
  for (const bad of ['12.5', '1e2', '12,50', '0.1', ' 1.00', '']) assert.throws(() => core.moneyToCents(bad), /Valor monetário inválido/);
  assert.throws(() => core.moneyToCents(12.5));
});

teste('core: repasse é round_half_up(base x percentual / 100) em centavos', () => {
  const amount = (base, rate) => core.centsToMoney(core.commissionCents(core.moneyToCents(base), rate));
  assert.equal(amount('30.00', '30.00'), '9.00');
  assert.equal(amount('10.01', '30.00'), '3.00'); // 300,3 centavos
  assert.equal(amount('0.05', '50.00'), '0.03'); // 2,5 centavos sobe
  assert.equal(amount('0.15', '30.00'), '0.05'); // 4,5 centavos sobe
  assert.equal(amount('20.10', '35.00'), '7.04'); // 703,5 centavos sobe
  assert.equal(amount('33.33', '33.33'), '11.11'); // 1110,8889 centavos
  assert.equal(amount('0.01', '49.99'), '0.00');
  assert.equal(amount('0.01', '50.00'), '0.01');
  assert.equal(amount('999999999999999999.99', '100.00'), '999999999999999999.99');
  assert.equal(amount('999999999999999999.99', '33.33'), '333300000000000000.00'); // ...9999,6667 centavos sobe
  assert.equal(amount('45.00', '0.00'), '0.00');
  for (const bad of ['100.01', '-1.00', '30', '30.5', '1000.00', 'abc']) assert.throws(() => core.commissionCents(BigInt(100), bad), /Percentual inválido/);
  assert.throws(() => core.commissionCents(BigInt(-1), '30.00'), RangeError);
});

teste('core: percentual vigente no início (não informado antes de quitado_ate, abertura, histórico depois)', () => {
  // Fora de ordem de propósito: a vigência vem de vigente_desde, não da ordem das linhas.
  const agr = agreement([change('0.00', '2026-10-23 09:00:00'), change('35.00', '2026-10-21 14:00:00')]);
  eq(one(agr, '2026-10-20T05:59:59'), { status: 'not-informed' });
  eq(one(agr, '2026-10-20T06:00:00'), { status: 'known', rate: '30.00' });
  eq(one(agr, '2026-10-21T13:59:59'), { status: 'known', rate: '30.00' });
  eq(one(agr, '2026-10-21T14:00:00'), { status: 'known', rate: '35.00' });
  eq(one(agr, '2026-10-22T20:00:00'), { status: 'known', rate: '35.00' });
  eq(one(agr, '2026-10-23T09:00:00'), { status: 'known', rate: '0.00' });
  eq(one(agreement([change('40.00', '2026-10-19 10:00:00')]), '2026-10-19T12:00:00'), { status: 'not-informed' });
});

teste('core: histórico só de inclusão: alteração nova não muda o percentual de consultas já iniciadas', () => {
  const starts = ['2026-10-20T08:00:00', '2026-10-21T15:00:00', '2026-10-22T11:00:00'];
  const before = agreement([change('35.00', '2026-10-21 14:00:00')]);
  const after = agreement([...before.history, change('40.00', '2026-10-22 12:00:00')]);
  const rates = (agr) => core.consultationRates(agr, starts.map((startedAtLocal, i) => ({ id: `c${i}`, clientId: `cli${i}`, startedAtLocal })));
  eq([...rates(after).values()], [...rates(before).values()]);
  eq([...rates(before).values()].map((r) => r.rate), ['30.00', '35.00', '35.00']);
});

teste('core: alteração com consulta em curso: ela fica com o percentual do início', () => {
  const running = read({ iniConsulta: '2026-10-21 10:00:00', fimConsulta: null, tmpConsulta: null });
  eq(core.consultationRates(agreement([change('35.00', '2026-10-21 10:30:00')]), [running]).get(running.id), { status: 'known', rate: '30.00' });
});

teste('core: continuação (mesmo dia operacional, mesmo par) fica pendente de conferência', () => {
  const agr = agreement([change('35.00', '2026-10-21 14:00:00')]);
  const list = [
    { id: 'a0', clientId: 'A', startedAtLocal: '2026-10-21T05:30:00' }, // dia operacional 20
    { id: 'a1', clientId: 'A', startedAtLocal: '2026-10-21T10:00:00' },
    { id: 'a2', clientId: 'A', startedAtLocal: '2026-10-21T15:00:00' },
    { id: 'a3', clientId: 'A', startedAtLocal: '2026-10-22T05:59:00' }, // ainda dia 21
    { id: 'a4', clientId: 'A', startedAtLocal: '2026-10-22T09:00:00' }, // dia 22
    { id: 'b1', clientId: 'B', startedAtLocal: '2026-10-21T15:30:00' },
    { id: 'c1', clientId: 'C', startedAtLocal: '2026-10-21T05:00:00' }, // dia 20: não é "naquele dia"
    { id: 'c2', clientId: 'C', startedAtLocal: '2026-10-21T16:00:00' },
  ];
  const rates = core.consultationRates(agr, list);
  eq(rates.get('a1'), { status: 'known', rate: '30.00' });
  eq(rates.get('a2'), { status: 'pending-review', reason: 'continuation' });
  eq(rates.get('a3'), { status: 'pending-review', reason: 'continuation' });
  eq(rates.get('a4'), { status: 'known', rate: '35.00' });
  eq(rates.get('b1'), { status: 'known', rate: '35.00' });
  eq(rates.get('c2'), { status: 'known', rate: '35.00' });
  eq(core.consultationRates(agr, [...list].reverse()).get('a2'), rates.get('a2'));
  eq(core.consultationRates(agreement([change('30.00', '2026-10-21 14:00:00')]), list).get('a2'), { status: 'known', rate: '30.00' });
  const anonymous = core.consultationRates(agr, [{ id: 'x1', clientId: null, startedAtLocal: '2026-10-21T10:00:00' }, { id: 'x2', clientId: null, startedAtLocal: '2026-10-21T15:00:00' }]);
  eq(anonymous.get('x2'), { status: 'known', rate: '35.00' });
});

teste('core: tabela R12, linha 1 (finalizada, minutos, valor, sem bônus, sem abatimento usa valor_consulta)', () => {
  for (const over of [{}, { vlBonus: null, abatimento: null }, { valor_consulta: '44.40', tmpConsulta: 15 }]) {
    const c = read(over);
    eq(core.legacyConsultationBase(c, null), { status: 'known', base: c.recordedAmount, rule: 'recorded-amount' });
  }
  eq(core.legacyConsultationBase(read(), 'pendente'), { status: 'known', base: '30.00', rule: 'recorded-amount' });
  eq(core.legacyConsultationBase(read(), 'mantido'), { status: 'known', base: '30.00', rule: 'recorded-amount' });
});

teste('core: tabela R12, linha 2 (bônus, abatimento, valor 0/nulo, sem minutos ficam pendentes sem valor)', () => {
  const cases = [
    [{ vlBonus: 5 }, null, ['bonus']],
    [{ abatimento: '2.00' }, null, ['abatement']],
    [{ valor_consulta: '0.00' }, null, ['amount']],
    [{ valor_consulta: null }, null, ['amount']],
    [{ tmpConsulta: 0 }, null, ['minutes']],
    [{ tmpConsulta: null }, null, ['finished', 'minutes']],
    [{ fimConsulta: null }, null, ['finished']],
    [{ fimConsulta: '0000-00-00 00:00:00' }, null, ['finished']],
    [{ vlBonus: 10 }, 'mantido', ['bonus']],
    [{ vlBonus: 10, abatimento: '1.50' }, 'pendente', ['bonus', 'abatement']],
  ];
  for (const [over, cancellation, reasons] of cases) {
    const base = core.legacyConsultationBase(read(over), cancellation);
    eq(base, { status: 'pending-review', reasons }, JSON.stringify(over));
    assert.equal(core.consultationAmount(base, { status: 'known', rate: '30.00' }), null);
  }
});

teste('core: tabela R12, linha 3 (retirar repasse vale zero, mesmo com bônus)', () => {
  for (const over of [{}, { vlBonus: 10 }, { valor_consulta: null }]) {
    const base = core.legacyConsultationBase(read(over), 'retirado');
    eq(base, { status: 'known', base: '0.00', rule: 'removed' });
    assert.equal(core.consultationAmount(base, { status: 'known', rate: '30.00' }), '0.00');
    assert.equal(core.consultationAmount(base, { status: 'pending-review', reason: 'continuation' }), '0.00');
  }
});

teste('core: valor da consulta = base x percentual; zero é acordo válido e diferente de não informado', () => {
  const base = core.legacyConsultationBase(read({ valor_consulta: '44.40' }), null);
  assert.equal(core.consultationAmount(base, { status: 'known', rate: '30.00' }), '13.32');
  assert.equal(core.consultationAmount(base, { status: 'known', rate: '0.00' }), '0.00');
  assert.equal(core.consultationAmount(base, { status: 'not-informed' }), null);
  assert.equal(core.consultationAmount(base, { status: 'pending-review', reason: 'continuation' }), null);
  const zero = agreement([change('0.00', '2026-10-21 08:00:00')]);
  eq(one(zero, '2026-10-21T09:00:00'), { status: 'known', rate: '0.00' });
  eq(one(zero, '2026-10-19T09:00:00'), { status: 'not-informed' });
});

teste('core: "Valor Normal" e "Valor Cartão" do cadastro legado nunca entram no percentual nem na base', () => {
  const legacyFields = { vlPgtoNormal: '0.60', vlCartao: '0.60' };
  const c = read();
  const agr = agreement([change('35.00', '2026-10-21 14:00:00')]);
  eq(core.legacyConsultationBase({ ...c, ...legacyFields }, null), core.legacyConsultationBase(c, null));
  eq(core.consultationRates({ ...agr, ...legacyFields, opening: { ...opening0, ...legacyFields } }, [{ ...c, ...legacyFields }]).get(c.id), core.consultationRates(agr, [c]).get(c.id));
  const source = fs.readFileSync(path.join(raiz, 'repasse.core.js'), 'utf8');
  assert.doesNotMatch(source, /vlPgtoNormal|vlCartao|Valor Normal|Valor Cartão/i);
});

// ---- Apuração (T038): data-model, seções 3 e 4; R13, R14 e R17 ----

const ab = (over = {}) => ({
  id: 'ab1', status: 'confirmada', settledThrough: '2026-10-19 06:00:00', migrationCut: '2026-10-23 18:00:00',
  remainingBalance: '0.00', rate: '30.00', lastPayment: { paidOn: '2026-10-19', amount: '480.00', sheetRef: 'Repasses.xlsx, linha 12' }, ...over,
});
const ledger = (over = {}) => ({
  tarotId: '27', name: 'Osíris', opening: ab(), rates: [], schedule: { kind: 'weekday', weekday: 'segunda' },
  consultations: [], cancellations: [], adjustments: [], transfers: [], debts: [], divergenceCount: 0, ...over,
});
const cons = (id, start, amount, over = {}) => read({ idConsulta: id, iniConsulta: start, fimConsulta: `${start.slice(0, 14)}50:00`, valor_consulta: amount, ...over });
const adj = (id, amount, date, over = {}) => ({
  id, kind: amount.startsWith('-') ? 'desconto' : 'bonus', amount, description: `Ajuste ${id}`, date,
  periodStart: date, periodEnd: date, openingId: null, status: 'valido', corrects: null, ...over,
});
const pay = (id, amount, paidOn, over = {}) => ({
  id, amount, paidOn, periodStart: paidOn, periodEnd: paidOn, balanceAtDate: amount, status: 'valido', corrects: null, deductions: [], ...over,
});
const debt = (id, amount, installments, over = {}) => ({
  id, kind: 'advance', origin: 'novo', openingId: null, amount, deliveredOn: '2026-10-26', originalDeliveryOn: null, referenceDate: null,
  status: 'valido', corrects: null, installments: installments.map(([date, value], i) => ({ sequence: i + 1, date, amount: value })), ...over,
});
const cents = (lines) => lines.reduce((sum, line) => (line.amount === null ? sum : sum + core.moneyToCents(line.amount)), ZERO);
const byKind = (composition, kind) => composition.lines.filter((line) => line.kind === kind);
const noPending = { pendingReviewCount: 0, pendingCancellationCount: 0 };
const NOW = '2027-01-04T12:00:00';
const compose = (input, date, now = NOW) => core.payoutComposition(input, date, now);
const dueRow = (input, date, now = NOW) => core.buildDueRow(input, date, now);

teste('core: saldo em D = remanescente + repasses + ajustes válidos - pagamentos válidos', () => {
  const input = ledger({
    opening: ab({ remainingBalance: '12.50' }),
    consultations: [
      cons(101, '2026-10-19 05:30:00', '100.00'), // antes de quitado_ate: fora
      cons(102, '2026-10-19 06:00:00', '30.00'), // 900
      cons(103, '2026-10-22 14:00:00', '44.40'), // 1332
      cons(104, '2026-10-26 05:30:00', '20.00'), // 600
      cons(105, '2026-10-26 06:00:00', '50.00'), // fora
    ],
    adjustments: [
      adj('a1', '10.00', '2026-10-21'), adj('a2', '-3.00', '2026-10-26'), adj('a3', '7.00', '2026-10-27'),
      adj('a4', '100.00', '2026-10-22', { status: 'substituido' }), adj('a5', '8.00', '2026-10-22', { corrects: 'a4' }),
    ],
    transfers: [pay('t1', '5.00', '2026-10-24'), pay('t2', '40.00', '2026-10-27'), pay('t3', '20.00', '2026-10-24', { status: 'substituido' })],
  });
  const composition = compose(input, '2026-10-26');
  eq(composition.totals, { balance: '50.82', due: '50.82', ...noPending });
  assert.equal(cents(composition.lines), BigInt(5082));
  eq(byKind(composition, 'opening-balance').map((l) => [l.openingId, l.amount]), [['ab1', '12.50']]);
  eq(byKind(composition, 'consultation').map((l) => [l.consultationId, l.amount]), [['102', '9.00'], ['103', '13.32'], ['104', '6.00']]);
  eq(byKind(composition, 'adjustment').map((l) => [l.adjustmentId, l.amount]), [['a1', '10.00'], ['a5', '8.00'], ['a2', '-3.00']]);
  eq(byKind(composition, 'transfer').map((l) => [l.transferId, l.amount]), [['t1', '-5.00']]);
  eq(byKind(composition, 'consultation')[1], {
    kind: 'consultation', consultationId: '103', startedAtLocal: input.consultations[2].startedAtLocal, date: '2026-10-22', minutes: 20, base: '44.40', rate: '30.00', amount: '13.32', status: 'normal',
  });
});

teste('core: período apurado (pagamentos e descontos cobrem os créditos do mais antigo para o mais novo)', () => {
  const consultations = [
    cons(201, '2026-10-20 10:00:00', '30.00'), cons(202, '2026-10-22 10:00:00', '30.00'), cons(203, '2026-10-27 10:00:00', '30.00'),
    cons(204, '2026-10-29 10:00:00', '30.00'), cons(205, '2026-11-02 05:30:00', '30.00'),
  ];
  const transfers = [pay('t1', '13.50', '2026-10-26', { periodStart: '2026-10-21', periodEnd: '2026-10-25' })];
  const row = dueRow(ledger({ consultations, transfers }), '2026-11-02');
  assert.equal(row.due, '31.50');
  eq(row.period, { start: '2026-10-22', end: '2026-11-01' });
  const discounted = dueRow(ledger({ consultations, transfers, adjustments: [adj('d1', '-4.50', '2026-10-28')] }), '2026-11-02');
  eq([discounted.due, discounted.period], ['27.00', { start: '2026-10-27', end: '2026-11-01' }]);
  const paid = dueRow(ledger({ consultations, transfers: [...transfers, pay('t2', '31.50', '2026-11-02')] }), '2026-11-02');
  eq([paid.due, paid.net, paid.period], ['0.00', '0.00', null]);
});

teste('core: data prevista (weekday, monthdays, keep, next-business-day, dia inexistente sinalizado sem troca)', () => {
  const expected = core.expectedPayment;
  const tuesday = { kind: 'weekday', weekday: 'terca' };
  eq(expected(tuesday, '2026-10-27'), { date: '2026-10-27', issue: null });
  eq(expected(tuesday, '2026-10-24'), { date: '2026-10-27', issue: null });
  eq(expected(tuesday, '2026-10-28'), { date: '2026-11-03', issue: null });
  const keep15 = { kind: 'monthdays', days: [15], weekendPolicy: 'keep' };
  const next15 = { kind: 'monthdays', days: [15], weekendPolicy: 'next-business-day' };
  eq(expected(keep15, '2026-11-10'), { date: '2026-11-15', issue: null });
  eq(expected(next15, '2026-11-10'), { date: '2026-11-16', issue: null });
  eq(expected(next15, '2026-11-16'), { date: '2026-11-16', issue: null });
  eq(expected(keep15, '2026-11-16'), { date: '2026-12-15', issue: null });
  eq(expected(next15, '2026-08-14'), { date: '2026-08-17', issue: null });
  eq(expected({ ...keep15, weekendPolicy: null }, '2026-11-10'), { date: '2026-11-15', issue: null });
  const days10and31 = { kind: 'monthdays', days: [31, 10], weekendPolicy: 'keep' };
  eq(expected(days10and31, '2026-10-11'), { date: '2026-10-31', issue: null });
  eq(expected(days10and31, '2026-11-05'), { date: '2026-11-10', issue: null });
  eq(expected(days10and31, '2026-11-11'), { date: null, issue: 'missing-month-day' });
  eq(expected({ ...days10and31, weekendPolicy: 'next-business-day' }, '2026-11-11'), { date: null, issue: 'missing-month-day' });
  eq(expected({ kind: 'none' }, '2026-11-11'), { date: null, issue: null });
  eq(expected(null, '2026-11-11'), { date: null, issue: null });
  const row = dueRow(ledger({ schedule: days10and31, opening: ab({ remainingBalance: '7.00' }) }), '2026-11-11');
  eq([row.expectedDate, row.expectedDateIssue, row.due], [null, 'missing-month-day', '7.00']);
});

teste('core: valor a pagar nunca negativo (saldo devedor, excesso de pagamento, ajuste negativo)', () => {
  const base = {
    opening: ab({ remainingBalance: '10.00' }), consultations: [cons(301, '2026-10-20 10:00:00', '30.00')],
    adjustments: [adj('d1', '-25.00', '2026-10-21')], transfers: [pay('t1', '4.00', '2026-10-24')],
  };
  const composition = compose(ledger(base), '2026-10-26');
  eq(composition.totals, { balance: '-10.00', due: '0.00', ...noPending });
  assert.equal(cents(composition.lines), BigInt(-1000));
  eq(byKind(composition, 'adjustment').map((l) => l.amount), ['-25.00']);
  eq(byKind(composition, 'transfer').map((l) => l.amount), ['-4.00']);
  const row = dueRow(ledger(base), '2026-10-26');
  eq([row.due, row.net, row.period], ['0.00', '0.00', null]);
  const next = dueRow(ledger({ ...base, consultations: [...base.consultations, cons(302, '2026-10-27 10:00:00', '50.00')] }), '2026-11-02');
  eq([next.due, next.net, next.period], ['5.00', '5.00', { start: '2026-10-27', end: '2026-10-27' }]);
});

teste('core: consulta pendente de conferência fica sem valor, fora do saldo, e é contada', () => {
  const input = ledger({
    rates: [change('35.00', '2026-10-21 14:00:00')],
    consultations: [
      cons(401, '2026-10-21 10:00:00', '30.00', { idUsuario: 7 }),
      cons(402, '2026-10-21 15:00:00', '30.00', { idUsuario: 7 }),
      cons(403, '2026-10-22 10:00:00', '30.00', { idUsuario: 8, vlBonus: 5 }),
      cons(404, '2026-10-22 11:00:00', '40.00', { idUsuario: 9 }),
    ],
  });
  const composition = compose(input, '2026-10-26');
  eq(byKind(composition, 'consultation').map((l) => [l.consultationId, l.base, l.rate, l.amount, l.status]), [
    ['401', '30.00', '30.00', '9.00', 'normal'],
    ['402', '30.00', null, null, 'pending-review'],
    ['403', null, '35.00', null, 'pending-review'],
    ['404', '40.00', '35.00', '14.00', 'normal'],
  ]);
  eq(composition.totals, { balance: '23.00', due: '23.00', pendingReviewCount: 2, pendingCancellationCount: 0 });
  const row = dueRow(input, '2026-10-26');
  eq([row.due, row.pendingReviewCount], ['23.00', 2]);
});

teste('core: cancelamento pendente e mantido pagam normal; retirado vale zero; contagem separada das divergências', () => {
  const input = ledger({
    consultations: [
      cons(501, '2026-10-20 10:00:00', '30.00'), cons(502, '2026-10-20 11:00:00', '30.00'), cons(503, '2026-10-20 12:00:00', '30.00'),
      cons(504, '2026-10-20 13:00:00', '30.00', { vlBonus: 5 }), cons(505, '2026-10-20 14:00:00', '30.00'),
    ],
    cancellations: [{ consultationId: '501', status: 'pendente' }, { consultationId: '502', status: 'mantido' },
      { consultationId: '503', status: 'retirado' }, { consultationId: '504', status: 'retirado' }],
  });
  const composition = compose(input, '2026-10-26');
  eq(byKind(composition, 'consultation').map((l) => [l.consultationId, l.base, l.amount, l.status]), [
    ['501', '30.00', '9.00', 'cancellation-pending'], ['502', '30.00', '9.00', 'cancellation-kept'],
    ['503', '0.00', '0.00', 'cancellation-removed'], ['504', '0.00', '0.00', 'cancellation-removed'],
    ['505', '30.00', '9.00', 'normal'],
  ]);
  eq(composition.totals, { balance: '27.00', due: '27.00', pendingReviewCount: 0, pendingCancellationCount: 1 });
  const row = dueRow({ ...input, divergenceCount: 2 }, '2026-10-26');
  eq([row.pendingCancellationCount, row.divergenceCount], [1, 2]);
});

teste('core: abertura não confirmada ou ausente: sem valor a pagar, sinalizada, com a data prevista', () => {
  const consultations = [cons(601, '2026-10-20 10:00:00', '30.00')];
  const cancellations = [{ consultationId: '601', status: 'pendente' }];
  for (const [opening, flag] of [[ab({ status: 'rascunho' }), 'draft'], [null, 'missing']]) {
    const input = ledger({ opening, consultations, cancellations });
    eq(dueRow(input, '2026-10-26'), {
      tarotId: '27', name: 'Osíris', expectedDate: '2026-10-26', expectedDateIssue: null, period: null, due: null, suggestedDeductions: [], net: null,
      debtBalance: '0.00', pendingReviewCount: 0, pendingCancellationCount: 1, divergenceCount: 0, opening: flag, settledThrough: null,
    });
    const composition = compose(input, '2026-10-26');
    eq([composition.opening.status, composition.lines, composition.totals], [flag, [], null]);
  }
});

teste('core: último pagamento da abertura é só referência (nunca crédito nem pagamento)', () => {
  const composition = compose(ledger({ opening: ab({ remainingBalance: '12.50' }) }), '2026-10-26');
  eq(composition.opening, { status: 'confirmed', id: 'ab1', lastPayment: { paidOn: '2026-10-19', amount: '480.00', sheetRef: 'Repasses.xlsx, linha 12' } });
  eq(composition.lines.map((l) => [l.kind, l.amount]), [['opening-balance', '12.50']]);
  eq(composition.totals, { balance: '12.50', due: '12.50', ...noPending });
  eq(compose(ledger(), '2026-10-26').lines.map((l) => [l.kind, l.amount]), [['opening-balance', '0.00']]);
});

teste('core: saldo devedor = valor da dívida válida - descontos de pagamentos válidos até a data', () => {
  const dv1 = debt('dv1', '300.00', [['2026-11-02', '100.00'], ['2026-11-09', '100.00'], ['2026-11-16', '100.00']]);
  const transfers = [
    pay('t1', '50.00', '2026-11-02', { deductions: [{ debtId: 'dv1', amount: '100.00' }] }),
    pay('t2', '50.00', '2026-11-09', { status: 'substituido', deductions: [{ debtId: 'dv1', amount: '100.00' }] }),
    pay('t3', '50.00', '2026-11-09', { corrects: 't2', deductions: [{ debtId: 'dv1', amount: '60.00' }] }),
  ];
  const balances = (date) => core.debtBalances([dv1], transfers, date).map((i) => [i.debtId, i.balance]);
  eq(balances('2026-10-25'), []);
  eq(balances('2026-10-30'), [['dv1', '300.00']]);
  eq(balances('2026-11-02'), [['dv1', '200.00']]);
  eq(balances('2026-11-09'), [['dv1', '140.00']]);
  const dv2 = debt('dv2', '500.00', [['2026-11-02', '500.00']], { kind: 'loan', status: 'substituido' });
  const dv3 = debt('dv3', '450.00', [['2026-11-02', '450.00']], { kind: 'loan', corrects: 'dv2' });
  const before = [pay('t4', '10.00', '2026-11-02', { deductions: [{ debtId: 'dv2', amount: '100.00' }] })];
  eq(core.debtBalances([dv2, dv3], before, '2026-11-09'), [{ debtId: 'dv3', kind: 'loan', origin: 'novo', balance: '350.00' }]);
});

teste('core: correção de dívida abaixo do já descontado é recusada', () => {
  const dv1 = debt('dv1', '300.00', [['2026-11-02', '300.00']]);
  const transfers = [
    pay('t1', '50.00', '2026-11-02', { deductions: [{ debtId: 'dv1', amount: '100.00' }] }),
    pay('t2', '50.00', '2026-11-09', { status: 'substituido', deductions: [{ debtId: 'dv1', amount: '100.00' }] }),
    pay('t3', '50.00', '2026-11-09', { corrects: 't2', deductions: [{ debtId: 'dv1', amount: '60.00' }] }),
  ];
  eq(core.checkDebtCorrection([dv1], transfers, 'dv1', '159.99'), { ok: false, reason: 'below-deducted', deducted: '160.00' });
  eq(core.checkDebtCorrection([dv1], transfers, 'dv1', '160.00'), { ok: true });
  eq(core.checkDebtCorrection([dv1], [], 'dv1', '0.01'), { ok: true });
});

teste('core: parcela sugerida aparece à parte e só baixa a dívida quando o desconto é registrado', () => {
  const dv1 = debt('dv1', '300.00', [['2026-11-02', '100.00'], ['2026-11-09', '100.00'], ['2026-11-16', '100.00']]);
  const consultations = [
    cons(701, '2026-10-27 10:00:00', '500.00'), cons(702, '2026-10-28 10:00:00', '500.00'),
    cons(703, '2026-11-03 10:00:00', '500.00'), cons(704, '2026-11-04 10:00:00', '500.00'),
  ];
  eq(dueRow(ledger({ consultations, debts: [dv1] }), '2026-11-02'), {
    tarotId: '27', name: 'Osíris', expectedDate: '2026-11-02', expectedDateIssue: null, period: { start: '2026-10-27', end: '2026-10-28' }, due: '300.00',
    suggestedDeductions: [{ debtId: 'dv1', amount: '100.00' }], net: '200.00', debtBalance: '300.00', ...noPending, divergenceCount: 0, opening: 'confirmed', settledThrough: null,
  });
  const cash = dueRow(ledger({ consultations, debts: [dv1], transfers: [pay('t1', '300.00', '2026-11-02')] }), '2026-11-09');
  eq([cash.due, cash.suggestedDeductions, cash.net, cash.debtBalance], ['300.00', [{ debtId: 'dv1', amount: '200.00' }], '100.00', '300.00']);
  const transfers = [pay('t1', '200.00', '2026-11-02', { deductions: [{ debtId: 'dv1', amount: '100.00' }] })];
  const after = dueRow(ledger({ consultations, debts: [dv1], transfers }), '2026-11-09');
  eq([after.due, after.suggestedDeductions, after.net, after.debtBalance], ['300.00', [{ debtId: 'dv1', amount: '100.00' }], '200.00', '200.00']);
  const small = dueRow(ledger({ consultations: [cons(705, '2026-10-27 10:00:00', '200.00')], debts: [dv1] }), '2026-11-02');
  eq([small.due, small.suggestedDeductions, small.net, small.debtBalance], ['60.00', [{ debtId: 'dv1', amount: '60.00' }], '0.00', '300.00']);
});

teste('core: dívidas de migracao e novo ficam separadas do saldo de comissões; só conta a abertura vigente', () => {
  const consultations = [cons(801, '2026-10-20 10:00:00', '30.00')];
  const migration = { kind: 'loan', origin: 'migracao', deliveredOn: null, referenceDate: '2026-10-19' };
  const dm1 = debt('dm1', '300.00', [['2026-11-02', '300.00']], { ...migration, openingId: 'ab1' });
  const dv1 = debt('dv1', '150.00', [['2026-11-09', '150.00']]);
  const old = debt('dm0', '999.00', [['2026-11-02', '999.00']], { ...migration, openingId: 'ab0' });
  const without = compose(ledger({ consultations }), '2026-10-26');
  const withDebts = compose(ledger({ consultations, debts: [dm1, dv1, old] }), '2026-10-26');
  eq([withDebts.lines, withDebts.totals], [without.lines, without.totals]);
  assert.equal(withDebts.totals.balance, '9.00');
  assert.equal(dueRow(ledger({ consultations, debts: [dm1, dv1, old] }), '2026-10-26').debtBalance, '450.00');
  eq(core.debtBalances([dm1, dv1], [], '2026-10-26').map((i) => [i.debtId, i.kind, i.origin, i.balance]), [['dm1', 'loan', 'migracao', '300.00'], ['dv1', 'advance', 'novo', '150.00']]);
});

teste('core: na mesma data, a dívida da migração vem antes da nova, qualquer que seja o ID', () => {
  const opening = ab({ settledThrough: '2026-10-23 06:00:00', migrationCut: '2026-10-23 18:00:00', lastPayment: { paidOn: '2026-10-23', amount: '480.00', sheetRef: 'Repasses.xlsx, linha 12' } });
  const dm = debt('z-migracao', '100.00', [['2026-10-26', '100.00']], { kind: 'loan', origin: 'migracao', openingId: 'ab1', deliveredOn: null, referenceDate: '2026-10-23' });
  const dv = debt('a-novo', '100.00', [['2026-10-26', '100.00']], { deliveredOn: '2026-10-23' });
  const row = dueRow(ledger({ opening, consultations: [cons(1401, '2026-10-24 10:00:00', '200.00')], debts: [dv, dm] }), '2026-10-26');
  eq([row.due, row.suggestedDeductions, row.net], ['60.00', [{ debtId: 'z-migracao', amount: '60.00' }], '0.00']);
  eq(core.debtBalances([dv, dm], [], '2026-10-26').map((i) => i.debtId), ['z-migracao', 'a-novo']);
});

teste('core: mudança de calendário não desloca as parcelas já acordadas', () => {
  const dv1 = debt('dv1', '300.00', [['2026-11-02', '100.00'], ['2026-11-09', '100.00'], ['2026-11-16', '100.00']]);
  const consultations = [cons(901, '2026-10-27 10:00:00', '500.00')];
  const monday = dueRow(ledger({ consultations, debts: [dv1] }), '2026-11-03');
  const fifth = dueRow(ledger({ consultations, debts: [dv1], schedule: { kind: 'monthdays', days: [5], weekendPolicy: 'keep' } }), '2026-11-03');
  eq([monday.expectedDate, fifth.expectedDate], ['2026-11-09', '2026-11-05']);
  eq(monday.suggestedDeductions, [{ debtId: 'dv1', amount: '100.00' }]);
  eq([fifth.suggestedDeductions, fifth.due, fifth.net, fifth.debtBalance], [monday.suggestedDeductions, '150.00', '50.00', '300.00']);
});

teste('core: ajustes em aberto da abertura entram na composição com a origem; absorvidos ou pagos ficam fora', () => {
  const adjustments = [
    adj('o1', '15.00', '2026-10-10', { openingId: 'ab1' }),
    adj('o2', '-5.00', '2026-10-15', { openingId: 'ab1' }),
    adj('x1', '20.00', '2026-10-10', { openingId: 'ab0' }),
    adj('o3', '30.00', '2026-10-12', { openingId: 'ab1', status: 'substituido' }),
    adj('a1', '4.00', '2026-10-21'),
  ];
  const composition = compose(ledger({ opening: ab({ remainingBalance: '50.00' }), adjustments }), '2026-10-26');
  eq(byKind(composition, 'adjustment').map((l) => [l.adjustmentId, l.openingId, l.amount]), [['o1', 'ab1', '15.00'], ['o2', 'ab1', '-5.00'], ['a1', null, '4.00']]);
  eq(byKind(composition, 'adjustment')[0], { kind: 'adjustment', adjustmentId: 'o1', adjustmentKind: 'bonus', description: 'Ajuste o1', date: '2026-10-10', amount: '15.00', openingId: 'ab1' });
  eq(composition.totals, { balance: '64.00', due: '64.00', ...noPending });
});

teste('core: dívida da abertura começa pelo valor restante e não cobra de novo a parcela descontada antes da migração', () => {
  const dm1 = debt('dm1', '300.00', [['2026-10-26', '100.00'], ['2026-11-02', '100.00'], ['2026-11-09', '100.00']],
    { kind: 'loan', origin: 'migracao', openingId: 'ab1', deliveredOn: null, originalDeliveryOn: '2026-08-03', referenceDate: '2026-10-19' });
  const dv1 = debt('dv1', '50.00', [['2026-10-26', '50.00']], { deliveredOn: '2026-10-24' });
  const consultations = [cons(1001, '2026-10-20 10:00:00', '400.00')];
  const row = dueRow(ledger({ consultations, debts: [dv1, dm1] }), '2026-10-26');
  eq([row.due, row.suggestedDeductions, row.net, row.debtBalance], ['120.00', [{ debtId: 'dm1', amount: '100.00' }, { debtId: 'dv1', amount: '20.00' }], '0.00', '350.00']);
  const transfers = [pay('t1', '0.00', '2026-10-26', { deductions: [{ debtId: 'dm1', amount: '100.00' }, { debtId: 'dv1', amount: '20.00' }] })];
  const later = dueRow(ledger({ consultations: [...consultations, cons(1002, '2026-10-27 10:00:00', '500.00')], debts: [dv1, dm1], transfers }), '2026-11-02');
  eq([later.due, later.suggestedDeductions, later.net, later.debtBalance], ['150.00', [{ debtId: 'dm1', amount: '100.00' }, { debtId: 'dv1', amount: '30.00' }], '20.00', '230.00']);
});

teste('core: composição - as linhas somam o valor a pagar (abertura, consultas, adicional, pagamento e desconto de parcela)', () => {
  const dv1 = debt('dv1', '100.00', [['2026-10-26', '50.00'], ['2026-11-02', '50.00']]);
  const input = ledger({
    opening: ab({ remainingBalance: '30.00' }),
    consultations: [cons(1101, '2026-10-20 10:00:00', '100.00'), cons(1102, '2026-10-27 10:00:00', '100.00'), cons(1103, '2026-10-28 10:00:00', '100.00')],
    cancellations: [{ consultationId: '1103', status: 'pendente' }],
    adjustments: [adj('a1', '5.00', '2026-10-28')],
    transfers: [pay('t1', '10.00', '2026-10-26', { deductions: [{ debtId: 'dv1', amount: '50.00' }] })],
    debts: [dv1],
  });
  const composition = compose(input, '2026-11-02');
  eq(composition.lines.map((l) => l.kind), ['opening-balance', 'consultation', 'transfer', 'repayment', 'consultation', 'consultation', 'adjustment']);
  eq(byKind(composition, 'transfer'), [{ kind: 'transfer', transferId: 't1', date: '2026-10-26', amount: '-10.00', periodStart: '2026-10-26', periodEnd: '2026-10-26' }]);
  eq(byKind(composition, 'repayment'), [{ kind: 'repayment', transferId: 't1', debtId: 'dv1', debtKind: 'advance', date: '2026-10-26', amount: '-50.00' }]);
  eq(composition.totals, { balance: '65.00', due: '65.00', pendingReviewCount: 0, pendingCancellationCount: 1 });
  assert.equal(cents(composition.lines), core.moneyToCents(composition.totals.due));
  const row = dueRow(input, '2026-11-02');
  eq([row.due, row.suggestedDeductions, row.net, row.debtBalance, row.period], [composition.totals.due, [{ debtId: 'dv1', amount: '50.00' }], '15.00', '50.00', { start: '2026-10-27', end: '2026-10-28' }]);
});

teste('core: versão estável para as mesmas linhas e diferente quando uma linha muda', () => {
  const input = ledger({
    opening: ab({ remainingBalance: '20.00' }),
    consultations: [cons(1201, '2026-10-20 10:00:00', '30.00'), cons(1202, '2026-10-21 10:00:00', '30.00')],
    adjustments: [adj('a1', '5.00', '2026-10-21'), adj('a2', '-1.00', '2026-10-22')],
  });
  const version = (value) => compose(value, '2026-10-26').version;
  assert.match(version(input), /^[0-9a-f]{64}$/);
  assert.equal(version(structuredClone(input)), version(input));
  assert.equal(version({ ...input, consultations: [...input.consultations].reverse(), adjustments: [...input.adjustments].reverse() }), version(input));
  assert.notEqual(version({ ...input, adjustments: [adj('a1', '5.01', '2026-10-21'), input.adjustments[1]] }), version(input));
  assert.notEqual(version({ ...input, cancellations: [{ consultationId: '1201', status: 'retirado' }] }), version(input));
  assert.notEqual(version({ ...input, cancellations: [{ consultationId: '1201', status: 'pendente' }] }), version(input));
  const composition = compose(input, '2026-10-26');
  assert.equal(composition.version, core.payoutVersion(composition.lines));
  assert.equal(core.payoutVersion([{ a: '1.00', b: null }]), core.payoutVersion([{ b: null, a: '1.00' }]));
  assert.notEqual(core.payoutVersion([{ a: '1.00' }]), core.payoutVersion([{ a: '1.01' }]));
  const rows = [dueRow(input, '2026-10-26')];
  assert.equal(core.payoutVersion(structuredClone(rows)), core.payoutVersion(rows));
});

teste('core: relógio e IDs entram por argumento (o núcleo não lê a hora nem gera identificador)', () => {
  const source = fs.readFileSync(path.join(raiz, 'repasse.core.js'), 'utf8');
  assert.doesNotMatch(source, /Date\.now|new Date\(\)|Math\.random|randomUUID/);
  const input = ledger({ consultations: [cons(1301, '2026-10-20 10:00:00', '30.00')] });
  eq(dueRow(input, '2026-10-26'), dueRow(structuredClone(input), '2026-10-26'));
});

// ---- Decisões do PO de 2026-10-24 (T066) ----

teste('core (PO): percentual conferido vale desde quitado_ate; alteração com vigência anterior não vale no ciclo aberto', () => {
  const agr = agreement([change('40.00', '2026-10-19 10:00:00'), change('35.00', '2026-10-21 14:00:00')]);
  eq(one(agr, '2026-10-20T06:00:00'), { status: 'known', rate: '30.00' });
  eq(one(agr, '2026-10-21T13:59:59'), { status: 'known', rate: '30.00' });
  eq(one(agr, '2026-10-21T14:00:00'), { status: 'known', rate: '35.00' });
  eq(one(agreement([change('40.00', '2026-10-20 06:00:00')]), '2026-10-20T06:00:00'), { status: 'known', rate: '40.00' });
  eq(one(agreement([change('40.00', '2026-10-20 05:59:59')]), '2026-10-20T06:00:00'), { status: 'known', rate: '30.00' });
  const input = ledger({ rates: [change('40.00', '2026-10-18 10:00:00')], consultations: [cons(1501, '2026-10-20 10:00:00', '30.00')] });
  eq(byKind(compose(input, '2026-10-26'), 'consultation').map((l) => [l.rate, l.amount]), [['30.00', '9.00']]);
});

teste('core (PO): consulta em curso de hoje fica fora até terminar; sem fim de dias anteriores fica pendente', () => {
  const now = '2026-10-26T03:00:00';
  const open = (id, start, over = {}) => read({ idConsulta: id, iniConsulta: start, fimConsulta: null, tmpConsulta: null, ...over });
  const consultations = [
    open(1601, '2026-10-23 10:00:00'), open(1602, '2026-10-25 05:00:00'), cons(1603, '2026-10-25 08:00:00', '30.00'),
    open(1604, '2026-10-25 07:00:00'), open(1605, '2026-10-26 02:30:00', { fimConsulta: '2026-10-26 02:50:00' }),
  ];
  const input = ledger({ consultations });
  const composition = compose(input, '2026-10-26', now);
  eq(byKind(composition, 'consultation').map((l) => [l.consultationId, l.amount, l.status]), [['1601', null, 'pending-review'], ['1602', null, 'pending-review'], ['1603', '9.00', 'normal']]);
  eq(composition.totals, { balance: '9.00', due: '9.00', pendingReviewCount: 2, pendingCancellationCount: 0 });
  const row = dueRow(input, '2026-10-26', now);
  eq([row.due, row.pendingReviewCount], ['9.00', 2]);
  assert.equal(dueRow(ledger({ consultations, cancellations: [{ consultationId: '1604', status: 'pendente' }] }), '2026-10-26', now).pendingCancellationCount, 0);
  const finished = ledger({ consultations: [...consultations.slice(0, 3), cons(1604, '2026-10-25 07:00:00', '30.00')] });
  eq(compose(finished, '2026-10-26', now).totals, { balance: '18.00', due: '18.00', pendingReviewCount: 2, pendingCancellationCount: 0 });
  assert.equal(dueRow(input, '2026-10-27', '2026-10-26T10:00:00').pendingReviewCount, 4);
});

teste('core (PO): só contam os cancelamentos pendentes de consultas do ciclo apurado, iniciadas antes de D 06:00', () => {
  const consultations = [
    cons(1701, '2026-10-18 10:00:00', '30.00'), cons(1702, '2026-10-22 10:00:00', '30.00'),
    cons(1703, '2026-10-26 05:30:00', '30.00'), cons(1704, '2026-10-26 07:00:00', '30.00'),
  ];
  const cancellations = ['1701', '1702', '1703', '1704', '1799'].map((consultationId) => ({ consultationId, status: 'pendente' }));
  const input = ledger({ consultations, cancellations });
  assert.equal(compose(input, '2026-10-26').totals.pendingCancellationCount, 2);
  assert.equal(dueRow(input, '2026-10-26').pendingCancellationCount, 2);
  assert.equal(dueRow(input, '2026-10-27').pendingCancellationCount, 3);
  assert.equal(dueRow({ ...input, opening: ab({ status: 'rascunho' }) }, '2026-10-26').pendingCancellationCount, 3);
  assert.equal(dueRow({ ...input, opening: null }, '2026-10-26').pendingCancellationCount, 3);
});

teste('core (PO): data anterior ao período quitado: sem valor, com o aviso "quitado até"; os demais seguem normais', () => {
  const input = ledger({ opening: ab({ remainingBalance: '12.50' }), consultations: [cons(1801, '2026-10-20 10:00:00', '30.00')] });
  eq(dueRow(input, '2026-10-18'), {
    tarotId: '27', name: 'Osíris', expectedDate: '2026-10-19', expectedDateIssue: null, period: null, due: null, suggestedDeductions: [], net: null,
    debtBalance: '0.00', ...noPending, divergenceCount: 0, opening: 'confirmed', settledThrough: '2026-10-19T06:00:00',
  });
  const composition = compose(input, '2026-10-18');
  eq([composition.opening.status, composition.settledThrough, composition.lines, composition.totals], ['confirmed', '2026-10-19T06:00:00', [], null]);
  const first = dueRow(input, '2026-10-19');
  eq([first.settledThrough, first.due], [null, '12.50']);
  assert.equal(compose(input, '2026-10-19').settledThrough, null);
  const fraction = ledger({ opening: ab({ settledThrough: '2026-10-19 06:00:00.000' }) });
  eq([dueRow(fraction, '2026-10-19').settledThrough, dueRow(fraction, '2026-10-18').settledThrough], [null, '2026-10-19T06:00:00']);
  const other = dueRow(ledger({ tarotId: '31', name: 'Ísis', opening: ab({ id: 'ab2', settledThrough: '2026-10-12 06:00:00', remainingBalance: '20.00' }) }), '2026-10-18');
  eq([other.settledThrough, other.due, other.net], [null, '20.00', '20.00']);
});

// =====================================================================================================
// real-payout-agreement-model.test.mjs
// =====================================================================================================

const LAYA = { accountId: 'acc-1', displayName: 'Laya' };
const emptyAgr = () => ({ commission: { current: '30.00', since: null, history: [] }, schedule: { current: null, since: null, history: [] } });
const rateItem = (value, since, recordedAt, reason = null) => ({ value, since, reason, by: LAYA, recordedAt });
const calendar = (schedule, since, recordedAt, reason = null) => ({ schedule, since, reason, by: LAYA, recordedAt });

teste('acordo: lê o acordo do contrato e recusa outra forma', () => {
  eq(model.parseAgreement(emptyAgr()), emptyAgr());
  const full = {
    commission: { current: '35.00', since: '2026-10-24T14:32:10', history: [rateItem('35.00', '2026-10-24T14:32:10', '2026-10-24T17:32:10.120Z', 'Acordo revisto')] },
    schedule: { current: { kind: 'weekday', weekday: 'segunda' }, since: '2026-10-24T14:40:00', history: [calendar({ kind: 'weekday', weekday: 'segunda' }, '2026-10-24T14:40:00', '2026-10-24T17:40:00.000Z')] },
  };
  eq(model.parseAgreement(full), full);
  assert.equal(model.parseAgreement(null), null);
  assert.equal(model.parseAgreement({ commission: { current: 30, since: null, history: [] }, schedule: emptyAgr().schedule }), null);
  assert.equal(model.parseAgreement({ commission: emptyAgr().commission, schedule: { current: { kind: 'sabado' }, since: null, history: [] } }), null);
  assert.equal(model.parseAgreement({ ...emptyAgr(), commission: { ...emptyAgr().commission, history: [{ value: '35.00' }] } }), null);
});

teste('acordo: o percentual aparece com o símbolo colado e sem casas zeradas', () => {
  assert.equal(model.rateLabel('30.00'), '30%');
  assert.equal(model.rateLabel('35.50'), '35,5%');
  assert.equal(model.rateLabel('35.05'), '35,05%');
  assert.equal(model.rateLabel('0.00'), '0%');
  assert.equal(model.rateLabel('100.00'), '100%');
  assert.equal(model.rateFieldValue('35.50'), 35.5);
  assert.equal(model.rateFieldValue('30.00'), 30);
});

teste('acordo: o percentual digitado vira a taxa do contrato só de 0 a 100 com até 2 casas', () => {
  assert.equal(model.rateFromField(35), '35.00');
  assert.equal(model.rateFromField(35.5), '35.50');
  assert.equal(model.rateFromField(0.29), '0.29');
  assert.equal(model.rateFromField(12.34), '12.34');
  assert.equal(model.rateFromField(0), '0.00');
  assert.equal(model.rateFromField(100), '100.00');
  for (const invalid of [NaN, -0.01, 100.01, 35.123, 0.001, Infinity]) assert.equal(model.rateFromField(invalid), null, String(invalid));
});

teste('acordo: o calendário passa do campo aprovado ao contrato e volta, com A combinar como none', () => {
  eq(model.scheduleFromField(null), { kind: 'none' });
  eq(model.scheduleFromField({ kind: 'weekday', weekday: 'segunda' }), { kind: 'weekday', weekday: 'segunda' });
  eq(model.scheduleFromField({ kind: 'monthdays', days: [5, 20] }), { kind: 'monthdays', days: [5, 20], weekendPolicy: 'keep' });
  assert.equal(model.scheduleToField(null), null);
  assert.equal(model.scheduleToField({ kind: 'none' }), null);
  eq(model.scheduleToField({ kind: 'monthdays', days: [5], weekendPolicy: 'next-business-day' }), { kind: 'monthdays', days: [5], weekendPolicy: 'next-business-day' });
  assert.equal(model.scheduleProblem({ kind: 'monthdays', days: [], weekendPolicy: 'keep' }), 'Escolha ao menos um dia do mês.');
  assert.equal(model.scheduleProblem({ kind: 'none' }), null);
});

teste('acordo: só o que mudou é enviado, e o calendário sem registro equivale a A combinar', () => {
  const agr = emptyAgr();
  eq(model.agreementChanges(agr, { rate: '30.00', schedule: { kind: 'none' } }), { commission: null, schedule: null });
  eq(model.agreementChanges(agr, { rate: '35.00', schedule: { kind: 'none' } }), { commission: '35.00', schedule: null });
  eq(model.agreementChanges(agr, { rate: '30.00', schedule: { kind: 'weekday', weekday: 'segunda' } }), { commission: null, schedule: { kind: 'weekday', weekday: 'segunda' } });
  const set = { ...agr, schedule: { current: { kind: 'monthdays', days: [5, 20], weekendPolicy: 'keep' }, since: '2026-10-24T10:00:00', history: [] } };
  eq(model.agreementChanges(set, { rate: '30.00', schedule: { kind: 'monthdays', days: [5, 20], weekendPolicy: 'keep' } }), { commission: null, schedule: null });
  eq(model.agreementChanges(set, { rate: '30.00', schedule: { kind: 'none' } }).schedule, { kind: 'none' });
});

teste('acordo: o motivo vai aparado, e vazio não vai', () => {
  eq(model.commissionBody('35.00', '  Acordo revisto  ', 'k1'), { rate: '35.00', reason: 'Acordo revisto', operationKey: 'k1' });
  eq(model.commissionBody('35.00', '   ', 'k1'), { rate: '35.00', operationKey: 'k1' });
  eq(model.scheduleBody({ kind: 'none' }, '', 'k2'), { schedule: { kind: 'none' }, operationKey: 'k2' });
});

teste('acordo: um instante local do contrato aparece como a tela o diz', () => {
  assert.equal(model.localMomentLabel('2026-10-24T14:32:10'), '24/10/2026 às 14:32');
});

teste('acordo: o histórico junta percentual e calendário, do mais novo ao mais antigo, com o anterior de cada um', () => {
  const agr = {
    commission: { current: '40.00', since: '2026-10-24T15:00:00', history: [rateItem('35.00', '2026-10-24T14:32:10', '2026-10-24T17:32:10.000Z', 'Acordo revisto'), rateItem('40.00', '2026-10-24T15:00:00', '2026-10-24T18:00:00.000Z')] },
    schedule: { current: { kind: 'weekday', weekday: 'segunda' }, since: '2026-10-24T14:40:00', history: [calendar({ kind: 'weekday', weekday: 'segunda' }, '2026-10-24T14:40:00', '2026-10-24T17:40:00.000Z')] },
  };
  const entries = model.agreementHistory(agr, null);
  eq(entries.map((i) => [i.field, i.before, i.after]), [
    ['Percentual de repasse', '35%', '40%'],
    ['Calendário de pagamento', 'Dia de pagamento a combinar', 'Pagamento: segunda-feira'],
    ['Percentual de repasse', '30%', '35%'],
  ]);
  assert.equal(entries[2].since, '2026-10-24T14:32:10');
  assert.equal(entries[2].reason, 'Acordo revisto');
  assert.equal(entries[2].actorName, 'Laya');
  assert.equal(entries[2].recordedAt, '2026-10-24T17:32:10.000Z');
  assert.equal(new Set(entries.map((i) => i.id)).size, 3);
  assert.equal(model.agreementHistory(agr, { rate: '32.50' }).at(-1).before, '32,5%');
});

teste('acordo: de duas leituras, vale a de histórico mais longo; no empate, a mais recente', () => {
  const older = emptyAgr();
  const newer = { ...emptyAgr(), commission: { current: '35.00', since: '2026-10-24T14:32:10', history: [rateItem('35.00', '2026-10-24T14:32:10', '2026-10-24T17:32:10.000Z')] } };
  assert.equal(model.newestAgreement(older, newer), newer);
  assert.equal(model.newestAgreement(newer, older), newer);
  assert.equal(model.newestAgreement(older, null), older);
  const again = emptyAgr();
  assert.equal(model.newestAgreement(again, older), again);
});

teste('acordo: a chave da operação só se repete para reenviar o mesmo pedido sem resposta', () => {
  let k = 0;
  const keys = model.operationKeys(() => `k${++k}`);
  assert.equal(keys.next({ rate: '35.00' }), 'k1');
  assert.equal(keys.next({ rate: '35.00' }), 'k1');
  keys.settle();
  assert.equal(keys.next({ rate: '35.00' }), 'k2');
  assert.equal(keys.next({ rate: '36.00' }), 'k3');
});

// =====================================================================================================
// real-payout-opening-model.test.mjs
// =====================================================================================================

const revision = (over = {}) => ({
  id: 'op-1', tarotId: '9003', revision: 1, status: 'rascunho', corrects: null, correctionReason: null,
  lastPayment: { paidOn: '2026-10-20', amount: '250.00', sheetRef: 'Aba Outubro, linha 12' },
  settledThrough: '2026-10-20T06:00:00', migrationCut: '2026-10-24T06:00:00', remainingBalance: '120.50', remainingBalanceNote: 'Sobra de segunda', rate: '30.00',
  openAdjustments: [
    { id: 'aj-1', kind: 'bonus', amount: '30.00', description: 'Bônus de meta', date: '2026-10-22' },
    { id: 'aj-2', kind: 'desconto', amount: '-12.40', description: 'Multa de atraso', date: '2026-10-23' },
  ],
  debts: [{ id: 'dv-1', kind: 'loan', remaining: '300.00', originalDeliveryOn: null, sheetRef: 'Aba Empréstimos, linha 3', status: 'valido', corrects: null,
    installments: [{ date: '2026-10-31', amount: '150.00' }, { date: '2026-11-07', amount: '150.00' }] }],
  differences: [{ id: 'df-1', description: 'Bônus de agosto sem comprovante', amount: null, resolvedAt: null, resolvedBy: null }],
  enteredBy: LAYA, enteredAt: '2026-10-24T17:32:10.120Z', confirmedBy: null, confirmedAt: null, ...over,
});
const WEEKLY = { kind: 'weekday', weekday: 'segunda' };

teste('abertura: lê as revisões do contrato e recusa outra forma', () => {
  const data = { current: null, draft: revision(), revisions: [revision()] };
  eq(model.parseOpenings(data), data);
  eq(model.parseOpenings({ current: null, draft: null, revisions: [] }), { current: null, draft: null, revisions: [] });
  assert.equal(model.parseOpenings(null), null);
  assert.equal(model.parseOpenings({ current: null, draft: revision({ remainingBalance: 120.5 }), revisions: [] }), null);
  assert.equal(model.parseOpenings({ current: null, draft: revision({ status: 'apagada' }), revisions: [] }), null);
  assert.equal(model.parseOpenings({ current: null, draft: null }), null);
});

teste('abertura: o dinheiro do campo vira o texto do contrato, sem passar por número', () => {
  assert.equal(model.moneyFromField('120,50'), '120.50');
  assert.equal(model.moneyFromField(' 1.234,5 '), '1234.50');
  assert.equal(model.moneyFromField('0'), '0.00');
  assert.equal(model.moneyFromField('90071992547409,93'), '90071992547409.93');
  for (const text of ['', 'abc', '12,345', '1,2,3', '120.50', '-5,00', '1e3']) assert.equal(model.moneyFromField(text), null, text);
  assert.equal(model.moneyFromField('-5,00', { signed: true }), '-5.00');
  assert.equal(model.moneyToField('-1234.50'), '-1234,50');
  assert.equal(model.sumMoney(['0.10', '0.20', '-0.05']), '0.25');
  assert.equal(model.sumMoney([]), '0.00');
});

teste('abertura: as parcelas dividem o restante em centavos, com o resto nas últimas', () => {
  const d = { ...model.blankDebt('k'), remaining: '100,00', count: '3', frequency: 'weekly', firstDate: '2026-10-31' };
  const plan = model.debtPlan(d, null);
  eq(plan.rows, [{ date: '2026-10-31', amount: '33,33' }, { date: '2026-11-07', amount: '33,33' }, { date: '2026-11-14', amount: '33,34' }]);
  assert.equal(plan.balanced, true);
  assert.equal(plan.total, '100.00');
  const byPayment = model.debtPlan({ ...d, frequency: 'payment', firstDate: '2026-10-28' }, WEEKLY);
  eq(byPayment.rows.map((r) => r.date), ['2026-11-02', '2026-11-09', '2026-11-16']);
  assert.match(model.debtPlan({ ...d, frequency: 'payment' }, null).error, /Datas escolhidas/);
  const edited = model.editInstallment(model.editInstallment(d, null, 0, 'date', '2026-11-01'), null, 1, 'amount', '10,00');
  assert.equal(edited.frequency, 'custom');
  const editedPlan = model.debtPlan(edited, null);
  assert.equal(editedPlan.rows[0].date, '2026-11-01');
  assert.equal(editedPlan.balanced, false);
  assert.equal(editedPlan.total, '76.67');
});

function filled() {
  const form = model.blankForm({ today: '2026-10-24', rate: '30.00' });
  return {
    ...form, lastPaidOn: '2026-10-20', lastAmount: '250,00', lastSheetRef: 'Aba Outubro, linha 12', settledDay: '2026-10-19',
    balance: '120,50', balanceNote: 'Sobra de segunda',
    adjustments: [{ ...model.blankAdjustment('a'), kind: 'bonus', date: '2026-10-22', amount: '30,00', description: 'Bônus de meta' },
      { ...model.blankAdjustment('b'), kind: 'desconto', date: '2026-10-23', amount: '12,40', description: 'Multa de atraso' }],
    debts: [model.editInstallment({ ...model.blankDebt('d'), kind: 'loan', remaining: '300,00', sheetRef: 'Aba Empréstimos, linha 3', count: '2', frequency: 'weekly', firstDate: '2026-10-31' }, null, 0, 'date', '2026-10-31')],
    differences: [{ ...model.blankDifference('f'), description: 'Bônus de agosto sem comprovante' }],
  };
}

teste('abertura: o pedido de lançar leva o corpo do contrato, com o corte das 6h e o desconto negativo', () => {
  assert.equal(model.blankForm({ today: '2026-10-24', rate: '35.50' }).migrationCut, '2026-10-24T06:00');
  assert.equal(model.blankForm({ today: '2026-10-24', rate: '35.50' }).rate, 35.5);
  assert.equal(model.settledThroughLabel('2026-10-19'), 'Consultas iniciadas até 20/10 às 6h estão quitadas.');
  const result = model.openingRequest(filled(), { tarotId: '9003', correcting: false });
  eq(result, {
    fields: {
      tarotId: '9003', lastPayment: { paidOn: '2026-10-20', amount: '250.00', sheetRef: 'Aba Outubro, linha 12' },
      settledThrough: '2026-10-20T06:00:00', remainingBalance: '120.50', remainingBalanceNote: 'Sobra de segunda', migrationCut: '2026-10-24T06:00:00', rate: '30.00',
      openAdjustments: [{ kind: 'bonus', amount: '30.00', description: 'Bônus de meta', date: '2026-10-22' }, { kind: 'desconto', amount: '-12.40', description: 'Multa de atraso', date: '2026-10-23' }],
      debts: [{ kind: 'loan', remaining: '300.00', originalDeliveryOn: null, sheetRef: 'Aba Empréstimos, linha 3', installments: [{ date: '2026-10-31', amount: '150.00' }, { date: '2026-11-07', amount: '150.00' }] }],
      differences: [{ description: 'Bônus de agosto sem comprovante', amount: null }],
    },
  });
});

teste('abertura: o pedido é recusado na tela com as regras do servidor, sem enviar nada', () => {
  const refused = (changeIt, options = { tarotId: '9003', correcting: false }) => model.openingRequest({ ...filled(), ...changeIt }, options).problem;
  assert.match(refused({ settledDay: '2026-10-24' }), /antes do corte/);
  assert.match(refused({ balance: '' }), /saldo remanescente/i);
  assert.equal(refused({ balance: '0,00' }), undefined);
  assert.equal(refused({ balance: '-15,00' }), undefined);
  assert.match(refused({ lastSheetRef: ' ' }), /linha da planilha/i);
  assert.match(refused({ rate: 100.5 }), /percentual/i);
  const [d] = filled().debts;
  assert.match(refused({ debts: [model.editInstallment(d, null, 1, 'amount', '100,00')] }), /soma das parcelas/);
  assert.match(refused({ debts: [model.editInstallment(d, null, 0, 'date', '2026-10-23')] }), /antes do dia do corte/);
  assert.match(refused({ adjustments: [{ ...model.blankAdjustment('x'), date: '2026-10-22', amount: '0,00', description: 'Zero' }] }), /valor/i);
  assert.match(refused({}, { tarotId: '9003', correcting: true }), /motivo da correção/i);
  assert.equal(model.openingRequest({ ...filled(), reason: 'Saldo errado' }, { tarotId: '9003', correcting: true }).fields.reason, 'Saldo errado');
});

teste('abertura: a correção parte da revisão como foi gravada e a devolve igual', () => {
  const op = revision();
  const form = model.formFromOpening(op);
  assert.equal(form.balance, '120,50');
  assert.equal(form.settledDay, '2026-10-19');
  assert.equal(form.migrationCut, '2026-10-24T06:00');
  assert.equal(form.adjustments[1].amount, '12,40');
  eq(model.debtPlan(form.debts[0], WEEKLY).rows, [{ date: '2026-10-31', amount: '150,00' }, { date: '2026-11-07', amount: '150,00' }]);
  const { fields } = model.openingRequest({ ...form, reason: 'Conferido de novo' }, { tarotId: '9003', correcting: true, schedule: WEEKLY });
  eq(fields.debts, op.debts.map(({ kind, remaining, originalDeliveryOn, sheetRef, installments }) => ({ kind, remaining, originalDeliveryOn, sheetRef, installments })));
  eq(fields.openAdjustments, op.openAdjustments.map(({ kind, amount, description, date }) => ({ kind, amount, description, date })));
  assert.equal(fields.remainingBalance, '120.50');
  assert.equal(fields.settledThrough, op.settledThrough);
});

teste('abertura: a etiqueta de cada revisão, o resumo em centavos e a leitura mais nova', () => {
  const first = revision({ status: 'confirmada', confirmedBy: LAYA, confirmedAt: '2026-10-24T17:40:00.000Z' });
  const second = revision({ id: 'op-2', revision: 2, status: 'confirmada', corrects: 1, correctionReason: 'Saldo' });
  const confirmed = { current: second, draft: null, revisions: [first, second] };
  eq(confirmed.revisions.map((i) => model.revisionTag(i, confirmed.current)), ['Substituída', 'Vigente']);
  assert.equal(model.revisionTag(revision({ status: 'descartada' }), null), 'Descartada');
  assert.equal(model.revisionTag(revision(), null), 'Rascunho');
  eq(model.openingTotals(revision()), { balance: '120.50', additions: '30.00', discounts: '12.40', debts: '300.00' });
  const drafted = { current: null, draft: revision(), revisions: [revision()] };
  assert.equal(model.newestOpenings(drafted, confirmed), confirmed);
  assert.equal(model.newestOpenings(confirmed, drafted), confirmed);
  assert.equal(model.newestOpenings(drafted, null), drafted);
  assert.equal(model.momentLabel('2026-10-24T17:32:10.120Z'), '24/10/2026 14:32');
});

// =====================================================================================================
// real-payout-parity.test.mjs (sem o oráculo v584: âncoras à mão, valores literais e invariantes)
// =====================================================================================================

const TODAY = '2026-10-02';
const NOW_LOCAL = `${TODAY}T12:00:00`;
const TARO = '27';
const OPENING_ID = 'ab1';

const plusMinutes = (local, minutes) => new Date(Date.parse(`${local.replace(' ', 'T')}Z`) + minutes * 60000).toISOString().slice(0, 19).replace('T', ' ');
const days = (start, end) => { const out = []; for (let date = start; date <= end; date = shiftDateKey(date, 1)) out.push(date); return out; };
const sumTexts = (texts) => core.centsToMoney(texts.reduce((total, t) => total + core.moneyToCents(t), ZERO));

const pConsultation = (id, start, minutes, unit, rate, over = {}) => ({ id, start, minutes, unit, rate, cancellation: null, open: false, ...over });
const pAdjustment = (id, date, amount, fromOpening = false) => ({ id, date, amount, fromOpening });
const pTransfer = (id, paidOn, amount, deductions = []) => ({ id, paidOn, amount, deductions });
const pDebt = (id, kind, origin, date, amount, installments, time = '12:00', frequency = 'custom') => ({ id, kind, origin, date, time, amount, installments, frequency });
const baseOf = (item) => core.centsToMoney(BigInt(item.minutes) * core.moneyToCents(item.unit));

function toCore(s) {
  return {
    tarotId: TARO, name: 'Osíris', schedule: s.schedule, rates: s.rates, divergenceCount: 0,
    opening: {
      id: OPENING_ID, status: 'confirmada', settledThrough: s.opening.settledThrough, remainingBalance: s.opening.remainingBalance, rate: s.opening.rate,
      lastPayment: { paidOn: s.opening.lastPaid, amount: '480.00', sheetRef: 'Repasses.xlsx, linha 12' },
    },
    consultations: s.consultations.map((item) => readLegacyConsultation({
      idConsulta: item.id, idUsuario: 10, idTarologo: 27, nome_id: 'Marina', nmuTarologo: 'Osíris',
      iniConsulta: item.start, fimConsulta: item.open ? null : plusMinutes(item.start, item.minutes), tmpConsulta: item.open ? null : item.minutes,
      valor_consulta: baseOf(item), vlBonus: 0, vlDesconto: 0, abatimento: '0.00',
    })),
    cancellations: s.consultations.filter((item) => item.cancellation).map((item) => ({ consultationId: String(item.id), status: item.cancellation })),
    adjustments: s.adjustments.map((item) => ({
      id: item.id, kind: item.amount.startsWith('-') ? 'desconto' : 'bonus', amount: item.amount, description: `Ajuste ${item.id}`,
      date: item.date, openingId: item.fromOpening ? OPENING_ID : null, status: 'valido',
    })),
    transfers: s.transfers.map((item) => ({
      id: item.id, amount: item.amount, paidOn: item.paidOn, periodStart: item.paidOn, periodEnd: item.paidOn, status: 'valido',
      deductions: item.deductions.map(([debtId, amount]) => ({ debtId, amount })),
    })),
    debts: s.debts.map((item) => ({
      id: item.id, kind: item.kind, origin: item.origin, openingId: item.origin === 'migracao' ? OPENING_ID : null, amount: item.amount,
      deliveredOn: item.origin === 'novo' ? item.date : null, originalDeliveryOn: item.origin === 'migracao' ? item.date : null,
      referenceDate: item.origin === 'migracao' ? s.opening.lastPaid : null, status: 'valido', corrects: null,
      installments: item.installments.map(([date, amount], i) => ({ sequence: i + 1, date, amount })),
    })),
  };
}

// O calendário do núcleo no formato do `nextScheduledPayment` (política nula some, como a v584 recebe).
const refSchedule = (schedule) => (!schedule || schedule.kind === 'none' ? undefined
  : schedule.kind === 'weekday' ? { kind: 'weekday', weekday: schedule.weekday }
    : { kind: 'monthdays', days: [...schedule.days], ...(schedule.weekendPolicy ? { weekendPolicy: schedule.weekendPolicy } : {}) });

/** Invariantes contábeis do cenário em D (no lugar da comparação com a v584). */
function parity(s, date) {
  const input = toCore(s);
  const at = `D = ${date}`;
  const row = core.buildDueRow(input, date, NOW_LOCAL);
  const composition = core.payoutComposition(input, date, NOW_LOCAL);
  assert.ok(composition.totals !== null, at);
  assert.equal(cents(composition.lines), core.moneyToCents(composition.totals.balance), at);
  const saldo = core.moneyToCents(composition.totals.balance);
  assert.equal(composition.totals.due, core.centsToMoney(saldo > ZERO ? saldo : ZERO), at);
  assert.equal(row.due, composition.totals.due, at);
  assert.equal(row.net, core.centsToMoney(core.moneyToCents(row.due) - row.suggestedDeductions.reduce((t, i) => t + core.moneyToCents(i.amount), ZERO)), at);
  assert.ok(core.moneyToCents(row.net) >= ZERO, at);
  const balances = core.debtBalances(input.debts, input.transfers, date);
  assert.equal(row.debtBalance, sumTexts(balances.map((b) => b.balance)), at);
  assert.equal(row.expectedDate, nextScheduledPayment(refSchedule(s.schedule), date), at);
  assert.equal(composition.lines[0].date, s.opening.balanceDate, at);
  for (const item of row.suggestedDeductions) assert.ok(core.moneyToCents(item.amount) > ZERO, at);
  return { row, composition };
}

const main = {
  opening: { settledThrough: '2026-09-26 06:00:00', balanceDate: '2026-09-25', lastPaid: '2026-09-25', remainingBalance: '150.00', rate: '30.00' },
  rates: [{ rate: '25.00', effectiveFrom: '2026-09-20 09:00:00' }, { rate: '35.00', effectiveFrom: '2026-09-29 14:00:00' }],
  schedule: { kind: 'weekday', weekday: 'sexta' },
  consultations: [
    pConsultation(1, '2026-09-27 10:00:00', 20, '2.96', 30),
    pConsultation(2, '2026-09-28 05:30:00', 12, '4.99', 30),
    pConsultation(3, '2026-09-30 10:00:00', 25, '2.96', 35),
    pConsultation(4, '2026-09-30 15:00:00', 10, '2.98', 35, { cancellation: 'pendente' }),
    pConsultation(5, '2026-09-30 18:00:00', 10, '3.02', 35, { cancellation: 'mantido' }),
    pConsultation(6, '2026-09-30 19:00:00', 10, '3.00', 35, { cancellation: 'retirado' }),
    pConsultation(7, '2026-09-30 21:00:00', 0, '2.96', 35, { open: true }),
    pConsultation(8, '2026-10-01 20:00:00', 33, '3.33', 35),
    pConsultation(9, '2026-10-02 05:59:00', 10, '4.98', 35),
    pConsultation(10, '2026-10-02 07:00:00', 10, '3.02', 35, { cancellation: 'pendente' }),
    pConsultation(11, '2026-10-02 08:00:00', 0, '2.96', 35, { open: true }),
  ],
  adjustments: [pAdjustment('a0', '2026-09-25', '12.34', true), pAdjustment('a1', '2026-09-29', '25.00'), pAdjustment('a2', '2026-10-01', '-10.00')],
  transfers: [pTransfer('t1', '2026-09-28', '100.00', [['d1', '20.00']]), pTransfer('t2', '2026-10-01', '50.00', [['d2', '15.00']]), pTransfer('t3', TODAY, '30.00')],
  debts: [
    pDebt('d1', 'advance', 'novo', '2026-09-27', '60.00', [['2026-09-28', '20.00'], ['2026-10-01', '20.00'], ['2026-10-05', '20.00']], '10:00'),
    pDebt('d2', 'loan', 'migracao', '2026-09-10', '45.00', [['2026-10-01', '15.00'], ['2026-10-02', '15.00'], ['2026-10-09', '15.00']]),
  ],
};

teste('paridade: ciclo aberto - invariantes dia a dia e âncora à mão em 02/10', () => {
  for (const date of days('2026-09-26', '2026-10-03')) parity(main, date);
  // Âncora à mão: créditos 315,85 (abertura 150,00, ajustes 27,34 e consultas 138,51) menos 215,00 de pagamentos e
  // descontos; parcelas vencidas 15,00 da d2 e 20,00 da d1.
  const { row } = parity(main, TODAY);
  eq({ due: row.due, net: row.net, debtBalance: row.debtBalance, period: row.period, expectedDate: row.expectedDate },
    { due: '100.85', net: '65.85', debtBalance: '70.00', period: { start: '2026-09-30', end: '2026-10-01' }, expectedDate: TODAY });
  eq(row.suggestedDeductions, [{ debtId: 'd2', amount: '15.00' }, { debtId: 'd1', amount: '20.00' }]);
});

teste('paridade: diferenças decididas pelo PO em 2026-10-24 ficam explícitas', () => {
  const { row, composition } = parity(main, TODAY);
  const line = (lines, id) => lines.find((item) => item.kind === 'consultation' && item.consultationId === id);
  assert.equal(line(composition.lines, '1').rate, '30.00');
  eq([line(composition.lines, '7').status, line(composition.lines, '7').amount, row.pendingReviewCount], ['pending-review', null, 1]);
  const tomorrow = parity(main, '2026-10-03');
  assert.equal(line(tomorrow.composition.lines, '11'), undefined);
  assert.equal(tomorrow.row.pendingReviewCount, 1);
  eq([row.pendingCancellationCount, tomorrow.row.pendingCancellationCount], [1, 2]);
  const settled = core.buildDueRow(toCore(main), '2026-09-25', NOW_LOCAL);
  eq({ due: settled.due, net: settled.net, period: settled.period, suggestedDeductions: settled.suggestedDeductions, settledThrough: settled.settledThrough },
    { due: null, net: null, period: null, suggestedDeductions: [], settledThrough: '2026-09-26T06:00:00' });
});

teste('paridade: sugestão zerada - a dívida sem parcela vencida não aparece na sugestão', () => {
  eq(parity(main, '2026-09-26').row.suggestedDeductions, []);
});

teste('paridade: excesso de pagamento na abertura e ajuste negativo (valor a pagar nunca negativo)', () => {
  const s = {
    ...main, rates: [], opening: { ...main.opening, remainingBalance: '-40.00' },
    consultations: [pConsultation(1, '2026-09-27 10:00:00', 20, '2.96', 30), pConsultation(2, '2026-09-30 10:00:00', 25, '2.96', 30), pConsultation(3, '2026-10-01 20:00:00', 33, '3.33', 30)],
    adjustments: [pAdjustment('a1', '2026-09-28', '-5.00')], transfers: [],
    debts: [pDebt('d1', 'advance', 'novo', '2026-09-27', '20.00', [['2026-09-28', '20.00']])],
  };
  for (const date of days('2026-09-26', '2026-10-03')) parity(s, date);
  const owing = parity(s, '2026-09-30');
  eq([owing.composition.totals.balance, owing.row.due, owing.row.net, owing.row.period, owing.row.suggestedDeductions], ['-27.24', '0.00', '0.00', null, []]);
});

teste('paridade: dívidas do mesmo dia (migração antes da nova; depois pelo ID)', () => {
  const s = {
    ...main, rates: [], schedule: null, consultations: [], adjustments: [], transfers: [], opening: { ...main.opening, remainingBalance: '25.00' },
    debts: [pDebt('m1', 'advance', 'migracao', '2026-09-26', '30.00', [['2026-09-30', '30.00']], '20:00'), pDebt('n1', 'advance', 'novo', '2026-09-26', '30.00', [['2026-09-30', '30.00']], '15:00')],
  };
  eq(parity(s, '2026-10-01').row.suggestedDeductions, [{ debtId: 'm1', amount: '25.00' }]);
  const twoNew = {
    ...s, debts: [pDebt('a-nova', 'loan', 'novo', '2026-09-27', '30.00', [['2026-09-30', '30.00']], '18:00'), pDebt('b-nova', 'loan', 'novo', '2026-09-27', '30.00', [['2026-09-30', '30.00']], '08:00')],
  };
  eq(parity(twoNew, '2026-10-01').row.suggestedDeductions, [{ debtId: 'a-nova', amount: '25.00' }]);
});

teste('paridade: plano de parcelas acordadas sugere e baixa de forma consistente, dia a dia', () => {
  const schedule = { kind: 'monthdays', days: [5, 20], weekendPolicy: 'next-business-day' };
  // As datas e os valores do teste da B (que vêm do buildPayoutLoanPlan da v584) são reproduzidos pelo debtPlan portado.
  const plano = (remaining, count, firstDate, frequency) => model.debtPlan({ ...model.blankDebt('x'), remaining, count: String(count), firstDate, frequency }, schedule)
    .rows.map((r) => [r.date, r.amount.replace(',', '.')]);
  const p1 = plano('100,00', 3, '2026-08-07', 'weekly');
  const p2 = plano('250,00', 4, '2026-08-31', 'monthly');
  const p3 = plano('90,00', 3, '2026-08-12', 'payment');
  eq([p1, p2, p3], [
    [['2026-08-07', '33.33'], ['2026-08-14', '33.33'], ['2026-08-21', '33.34']],
    [['2026-08-31', '62.50'], ['2026-09-30', '62.50'], ['2026-10-31', '62.50'], ['2026-11-30', '62.50']],
    [['2026-08-20', '30.00'], ['2026-09-07', '30.00'], ['2026-09-21', '30.00']],
  ]);
  const debts = [pDebt('p1', 'advance', 'novo', '2026-08-03', '100.00', p1), pDebt('p2', 'loan', 'novo', '2026-08-10', '250.00', p2), pDebt('p3', 'loan', 'novo', '2026-08-12', '90.00', p3)];
  const s = {
    opening: { settledThrough: '2026-08-01 06:00:00', balanceDate: '2026-07-31', lastPaid: '2026-07-31', remainingBalance: '600.00', rate: '30.00' },
    rates: [], schedule, debts, adjustments: [],
    consultations: [pConsultation(1, '2026-08-05 10:00:00', 60, '2.96', 30), pConsultation(2, '2026-09-10 10:00:00', 30, '3.33', 30)],
    transfers: [pTransfer('q1', '2026-08-05', '150.00'), pTransfer('q2', '2026-08-14', '80.00', [['p1', '33.33']]),
      pTransfer('q3', '2026-08-20', '0.00', [['p1', '50.00'], ['p3', '30.00']]), pTransfer('q4', '2026-09-07', '40.00', [['p3', '10.00']]),
      pTransfer('q5', '2026-10-01', '20.00', [['p2', '125.00']])],
  };
  const dates = days('2026-08-01', TODAY);
  const rows = dates.map((date) => parity(s, date).row);
  assert.ok(rows.some((r) => r.suggestedDeductions.length > 1));
  const short = { ...s, opening: { ...s.opening, remainingBalance: '330.00' } };
  const shortRows = dates.map((date) => parity(short, date).row);
  assert.ok(shortRows.some((r) => r.net === '0.00' && r.suggestedDeductions.length > 0));
  assert.ok(shortRows.some((r) => core.moneyToCents(r.due) === ZERO && r.debtBalance !== '0.00'));
  const moved = { ...s, schedule: { kind: 'weekday', weekday: 'segunda' } };
  dates.forEach((date, i) => eq(parity(moved, date).row.suggestedDeductions, rows[i].suggestedDeductions, date));
});

teste('paridade: data prevista do núcleo = nextScheduledPayment, dia a dia por dois anos', () => {
  const schedules = [
    ...['segunda', 'terca', 'quarta', 'quinta', 'sexta'].map((weekday) => ({ kind: 'weekday', weekday })),
    { kind: 'monthdays', days: [5, 20], weekendPolicy: 'keep' },
    { kind: 'monthdays', days: [5, 20], weekendPolicy: 'next-business-day' },
    { kind: 'monthdays', days: [1, 15, 31], weekendPolicy: 'next-business-day' },
    { kind: 'monthdays', days: [29], weekendPolicy: null },
    { kind: 'monthdays', days: [30, 31], weekendPolicy: 'next-business-day' },
  ];
  let missing = 0;
  for (const schedule of schedules) {
    for (const date of days('2027-01-01', '2028-12-31')) {
      const expected = core.expectedPayment(schedule, date);
      assert.equal(expected.date, nextScheduledPayment(refSchedule(schedule), date), `${JSON.stringify(schedule)} em ${date}`);
      if (expected.date === null) {
        assert.equal(expected.issue, 'missing-month-day');
        missing++;
      }
    }
  }
  assert.ok(missing > 0);
});

// =====================================================================================================
// Verificações próprias da API A: DTO exato, validação, somente leitura, rotas
// =====================================================================================================

const TS = '1792863130120'; // BIGINT volta como texto

teste('dto: acordo no formato EXATO { commission, schedule } (padrão 30% sem registro)', () => {
  eq(dto.acordoDe({ percentuais: [], calendarios: [], aberturas: [] }), emptyAgr());
  assert.notEqual(model.parseAgreement(dto.acordoDe({ percentuais: [], calendarios: [], aberturas: [] })), null);
});

teste('dto: acordo com histórico (ordem por vigência, percentual do ciclo da abertura vigente, by sem nome)', () => {
  const percentuais = [
    { id: 'p2', tarot_id: '27', percentual: '40.00', vigente_desde: '2026-10-24 15:00:00', motivo: null, registrado_por: 'acc-1', registrado_em: String(Number(TS) + 1000) },
    { id: 'p1', tarot_id: '27', percentual: '25.00', vigente_desde: '2026-10-10 09:00:00', motivo: 'Antigo', registrado_por: 'acc-1', registrado_em: TS },
  ];
  const calendarios = [{ id: 'c1', tarot_id: '27', tipo: 'monthdays', dia_semana: null, dias_mes: '5,20', politica_fim_semana: null, vigente_desde: '2026-10-24 14:40:00', motivo: null, registrado_por: 'acc-1', registrado_em: TS }];
  const vazio = { pendencias: [], dividas: [], parcelas: [], ajustes: [] };
  const aberta = dto.lerAbertura(rowAbertura({ situacao: 'confirmada', quitado_ate: '2026-10-20 06:00:00', percentual_conferido: '32.50' }), vazio);
  const out = dto.acordoDe({ percentuais, calendarios, aberturas: [aberta] });
  // A alteração de 10/10 (25%) é anterior ao quitado_ate (20/10): não vale no ciclo aberto, mas segue no histórico.
  assert.equal(out.commission.current, '40.00');
  assert.equal(out.commission.since, '2026-10-24T15:00:00');
  eq(out.commission.history.map((h) => h.value), ['25.00', '40.00']);
  eq(out.commission.history[0], { value: '25.00', since: '2026-10-10T09:00:00', reason: 'Antigo', by: { accountId: 'acc-1', displayName: null }, recordedAt: new Date(Number(TS)).toISOString() });
  eq(out.schedule.current, { kind: 'monthdays', days: [5, 20], weekendPolicy: null });
  // Sem alteração dentro do ciclo, vale o percentual conferido da abertura, desde o quitado_ate.
  const semCiclo = dto.acordoDe({ percentuais: [percentuais[1]], calendarios: [], aberturas: [aberta] });
  eq([semCiclo.commission.current, semCiclo.commission.since], ['32.50', '2026-10-20T06:00:00']);
  assert.throws(() => dto.acordoDe({ percentuais: [{ ...percentuais[0], percentual: '40' }], calendarios: [], aberturas: [] }), /fora do formato/);
});

function rowAbertura(over = {}) {
  return {
    id: 'op-1', tarot_id: '9003', revisao: 1, situacao: 'rascunho', corrige_revisao: null, motivo_correcao: null,
    ultimo_pagamento_data: '2026-10-20', ultimo_pagamento_valor: '250.00', planilha_referencia: 'Aba Outubro, linha 12',
    quitado_ate: '2026-10-20 06:00:00', saldo_remanescente: '120.50', saldo_composicao: 'Sobra de segunda', corte_migracao: '2026-10-24 06:00:00',
    percentual_conferido: '30.00', lancado_por: 'acc-1', lancado_em: TS, confirmado_por: null, confirmado_em: null, operation_key: 'chave-1', ...over,
  };
}

teste('dto: aberturas no formato EXATO { current, draft, revisions[] } (dívidas na ordem do corpo, parcelas, ajustes, pendências)', () => {
  const k = (i) => dto.childKey('chave-1', 'divida', i);
  const dividas = [
    { id: 'dv-b', tarot_id: '9003', tipo: 'advance', origem: 'migracao', abertura_id: 'op-1', valor: '80.00', entrega_original: null, entregue_em: null, referencia_data: '2026-10-20', situacao: 'valido', corrige_id: null, planilha_referencia: 'L4', registrado_em: String(Number(TS) + 1), operation_key: k(1) },
    { id: 'dv-a', tarot_id: '9003', tipo: 'loan', origem: 'migracao', abertura_id: 'op-1', valor: '300.00', entrega_original: null, entregue_em: null, referencia_data: '2026-10-20', situacao: 'valido', corrige_id: null, planilha_referencia: 'Aba Empréstimos, linha 3', registrado_em: TS, operation_key: k(0) },
    { id: 'dv-novo', tarot_id: '9003', tipo: 'loan', origem: 'novo', abertura_id: null, valor: '10.00', entrega_original: null, entregue_em: '2026-10-25', referencia_data: null, situacao: 'valido', corrige_id: null, planilha_referencia: null, registrado_em: TS, operation_key: 'x' },
  ];
  const parcelas = [
    { divida_id: 'dv-a', sequencia: 2, data: '2026-11-07', valor: '150.00' }, { divida_id: 'dv-a', sequencia: 1, data: '2026-10-31', valor: '150.00' },
    { divida_id: 'dv-b', sequencia: 1, data: '2026-11-01', valor: '80.00' },
  ];
  const ajustes = [
    { id: 'aj-1', tarot_id: '9003', tipo: 'bonus', valor: '30.00', descricao: 'Bônus de meta', data: '2026-10-22', abertura_id: 'op-1' },
    { id: 'aj-x', tarot_id: '9003', tipo: 'bonus', valor: '1.00', descricao: 'Sem abertura', data: '2026-10-22', abertura_id: null },
  ];
  const pendencias = [{ id: 'df-1', abertura_id: 'op-1', descricao: 'Bônus de agosto sem comprovante', valor: null, resolvida_em: null, resolvida_por: null }];
  const filhos = { pendencias, dividas, parcelas, ajustes };
  const rascunho = dto.lerAbertura(rowAbertura(), filhos);
  const confirmada = dto.lerAbertura(rowAbertura({ id: 'op-0', revisao: 1, situacao: 'confirmada', confirmado_por: 'acc-2', confirmado_em: String(Number(TS) + 5000), operation_key: 'chave-0' }), filhos);
  const out = dto.aberturasDe([rascunho, dto.lerAbertura(rowAbertura({ id: 'op-2', revisao: 2, situacao: 'rascunho', corrige_revisao: 1, motivo_correcao: 'Saldo' }), filhos), confirmada]);
  assert.notEqual(model.parseOpenings(out), null);
  eq(out.revisions.map((r) => r.revision), [1, 1, 2]);
  assert.equal(out.current.id, 'op-0');
  assert.equal(out.draft.id, 'op-1');
  eq(out.draft.debts.map((d) => d.id), ['dv-a', 'dv-b']);
  eq(out.draft.debts[0].installments, [{ date: '2026-10-31', amount: '150.00' }, { date: '2026-11-07', amount: '150.00' }]);
  eq(out.draft.openAdjustments, [{ id: 'aj-1', kind: 'bonus', amount: '30.00', description: 'Bônus de meta', date: '2026-10-22' }]);
  eq(out.draft.differences, [{ id: 'df-1', description: 'Bônus de agosto sem comprovante', amount: null, resolvedAt: null, resolvedBy: null }]);
  eq(out.draft.enteredBy, { accountId: 'acc-1', displayName: null });
  assert.equal(out.draft.settledThrough, '2026-10-20T06:00:00');
  assert.equal(out.current.confirmedAt, new Date(Number(TS) + 5000).toISOString());
  eq(out.revisions[2].corrects, 1);
  eq(dto.aberturasDe([]), { current: null, draft: null, revisions: [] });
  eq(Object.keys(out.draft), ['id', 'tarotId', 'revision', 'status', 'corrects', 'correctionReason', 'lastPayment', 'settledThrough', 'migrationCut',
    'remainingBalance', 'remainingBalanceNote', 'rate', 'openAdjustments', 'debts', 'differences', 'enteredBy', 'enteredAt', 'confirmedBy', 'confirmedAt']);
});

teste('validação: ID do tarólogo (texto, sem zero à esquerda)', () => {
  assert.equal(validacao.idTarologo('27'), '27');
  for (const ruim of ['007', '0', '', 'abc', '2147483648', '12345678901', undefined, '1.5']) assert.throws(() => validacao.idTarologo(ruim), (e) => e.statusCode === 400, String(ruim));
});

teste('validação: corpos de gravação (prontos para a escrita futura)', () => {
  eq(validacao.corpoPercentual({ rate: '35', operationKey: 'k1' }), { rate: '35.00', reason: null, operationKey: 'k1' });
  eq(validacao.corpoPercentual({ rate: '35.5', reason: 'Acordo', operationKey: 'k1' }), { rate: '35.50', reason: 'Acordo', operationKey: 'k1' });
  for (const ruim of [{ rate: '100.01', operationKey: 'k' }, { rate: 35, operationKey: 'k' }, { rate: '35', operationKey: 'k', extra: 1 }, { rate: '35' }, { rate: '35', reason: ' ', operationKey: 'k' }, { rate: '1000', operationKey: 'k' }]) {
    assert.throws(() => validacao.corpoPercentual(ruim), (e) => e.statusCode === 400, JSON.stringify(ruim));
  }
  eq(validacao.corpoCalendario({ schedule: { kind: 'none' }, operationKey: 'k' }).schedule, { kind: 'none' });
  assert.throws(() => validacao.corpoCalendario({ schedule: { kind: 'monthdays', days: [5, 5], weekendPolicy: 'keep' }, operationKey: 'k' }));
  assert.throws(() => validacao.corpoCalendario({ schedule: { kind: 'monthdays', days: [], weekendPolicy: 'keep' }, operationKey: 'k' }));
  assert.throws(() => validacao.corpoCalendario({ schedule: { kind: 'weekday', weekday: 'sabado' }, operationKey: 'k' }));
  const valido = {
    tarotId: '9003', lastPayment: { paidOn: '2026-10-20', amount: '250.00', sheetRef: 'Aba Outubro, linha 12' }, settledThrough: '2026-10-20T06:00:00',
    remainingBalance: '120.50', remainingBalanceNote: null, migrationCut: '2026-10-24T06:00:00', rate: '30',
    openAdjustments: [{ kind: 'desconto', amount: '-12.40', description: 'Multa', date: '2026-10-23' }],
    debts: [{ kind: 'loan', remaining: '300.00', originalDeliveryOn: null, sheetRef: 'L3', installments: [{ date: '2026-10-31', amount: '150.00' }, { date: '2026-11-07', amount: '150.00' }] }],
    differences: [{ description: 'Sem comprovante' }], operationKey: 'op-key-1',
  };
  eq(validacao.corpoAbertura(valido).rate, '30.00');
  eq(validacao.corpoCorrecao({ ...valido, reason: 'Saldo errado' }).reason, 'Saldo errado');
  const recusas = [
    { ...valido, settledThrough: '2026-10-20T07:00:00' }, // não é corte das 6h
    { ...valido, settledThrough: '2026-10-25T06:00:00' }, // depois do corte
    { ...valido, debts: [{ ...valido.debts[0], remaining: '299.99' }] }, // parcelas não somam
    { ...valido, debts: [{ ...valido.debts[0], installments: [{ date: '2026-10-23', amount: '150.00' }, { date: '2026-11-07', amount: '150.00' }] }] }, // parcela antes do corte
    { ...valido, remainingBalance: 120.5 }, // dinheiro como número
    { ...valido, remainingBalance: '-0.00' },
    { ...valido, lastPayment: { ...valido.lastPayment, amount: '-1.00' } },
    { ...valido, extra: true },
  ];
  for (const ruim of recusas) assert.throws(() => validacao.corpoAbertura(ruim), (e) => e.statusCode === 400);
  assert.throws(() => validacao.corpoCorrecao(valido), (e) => e.statusCode === 400); // sem reason
  eq(validacao.corpoConfirmar({ operationKey: 'k' }), { operationKey: 'k' });
  assert.throws(() => validacao.corpoConfirmar({ operationKey: ' k' }));
});

teste('serviço: ID inválido é recusado com 400 antes de qualquer acesso ao banco', async () => {
  process.env.LEGADO_DB_HOST = process.env.LEGADO_DB_HOST || '127.0.0.1';
  process.env.LEGADO_DB_NAME = process.env.LEGADO_DB_NAME || 'verificacao_offline';
  process.env.LEGADO_DB_USER = process.env.LEGADO_DB_USER || 'verificacao';
  const service = require(path.join(raiz, 'repasse.service'));
  await assert.rejects(service.acordo('007'), (e) => e.statusCode === 400);
  await assert.rejects(service.aberturas('abc'), (e) => e.statusCode === 400);
});

teste('somente leitura: nenhum arquivo da feature grava (create/update/destroy/bulk/upsert/query de escrita)', () => {
  const arquivos = [];
  (function varrer(dir) {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      // `escrita/` (gravações) tem a sua própria verificação: scripts/verificar-gf-repasse-escrita.js.
      if (fs.statSync(p).isDirectory()) { if (nome !== 'escrita') varrer(p); }
      else if (p.endsWith('.js')) arquivos.push(p);
    }
  })(raiz);
  assert.ok(arquivos.length >= 11);
  for (const arq of arquivos) {
    const src = fs.readFileSync(arq, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/createHash\([^)]*\)\.update\(/g, '');
    assert.doesNotMatch(src, /\.(create|update|destroy|bulkCreate|bulkUpdate|upsert|truncate|save|increment|decrement)\s*\(|sequelize\.query|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\.env\b/, path.relative(raiz, arq));
  }
});

teste('rotas: as duas leituras GET, com a permissão dinheiro.pagar_tarologas (as gravações POST são verificadas em verificar-gf-repasse-escrita.js)', () => {
  const router = require(path.join(raiz, 'repasse.routes'));
  const rotas = router.stack.filter((l) => l.route && l.route.methods.get).map((l) => ({ caminho: l.route.path, metodos: Object.keys(l.route.methods) }));
  eq(rotas, [{ caminho: '/tarologos/:id/acordo', metodos: ['get'] }, { caminho: '/tarologos/:id/aberturas', metodos: ['get'] }]);
  const src = fs.readFileSync(path.join(raiz, 'repasse.routes.js'), 'utf8');
  assert.ok((src.match(/requirePermission\('dinheiro\.pagar_tarologas'\)/g) || []).length >= 2);
});

(async () => {
  for (const caso of pendentes) await caso();
  console.log(`\n${ok} verificações ok, ${falhas.length} falha(s).`);
  if (falhas.length) {
    console.log(`Falharam: ${falhas.join(' | ')}`);
    process.exit(1);
  }
  process.exit(0);
})();
